#!/usr/bin/env python3
"""Add the Ivy bind mount while retaining Docker settings and a rollback container.

Run without --apply to inspect the plan. Requires Python 3 and access to Docker.
"""

import argparse
import copy
import hashlib
import http.client
import json
import os
from pathlib import Path
import signal
import socket
import ssl
import subprocess
import tempfile
import time
from urllib.parse import quote, urlencode, urlsplit


SOURCE = Path('/var/www/ivy')
DESTINATION = '/usr/share/nginx/html'
CONTAINER = 'nginx'


class DockerError(RuntimeError):
    pass


class UnixConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')


class Docker:
    def __init__(self):
        self.api_prefix = ''
        version = self.request('GET', '/version')['ApiVersion']
        if not all(part.isdigit() for part in version.split('.')) or len(version.split('.')) != 2:
            raise DockerError('Invalid Docker API version.')
        self.api_prefix = '/v' + version

    def request(self, method, route, body=None):
        connection = UnixConnection('localhost', timeout=35)
        try:
            connection.request(method, self.api_prefix + route, body=None if body is None else json.dumps(body),
                               headers={'Content-Type': 'application/json'})
            response = connection.getresponse()
            data = response.read()
            if response.status >= 300:
                # A Docker error body may quote environment values; do not log it.
                raise DockerError(f'Docker API HTTP {response.status}: {method} {route}')
            return json.loads(data) if data else None
        finally:
            connection.close()

    def inspect(self, identifier):
        return self.request('GET', f'/containers/{quote(identifier, safe="")}/json')

    def action(self, identifier, action, **query):
        route = f'/containers/{quote(identifier, safe="")}/{action}'
        if query:
            route += '?' + urlencode(query)
        return self.request('POST', route)


def build_config(original):
    if (original['Config'].get('Labels') or {}).get('com.docker.compose.project'):
        raise RuntimeError('This container is managed by Compose; update its Compose file instead.')
    host = copy.deepcopy(original['HostConfig'])
    if host.get('NetworkMode') != 'bridge':
        raise RuntimeError('Expected the inspected bridge network mode; no changes made.')
    if host.get('AutoRemove') or host.get('Links') or host.get('ContainerIDFile'):
        raise RuntimeError('Container has lifecycle or legacy-link settings requiring manual review.')
    for network in original['NetworkSettings']['Networks'].values():
        if any((network.get('IPAMConfig') or {}).get(key)
               for key in ('IPv4Address', 'IPv6Address', 'LinkLocalIPs')):
            raise RuntimeError('Explicit network addresses require a separate migration plan.')
    config = copy.deepcopy(original['Config'])
    config['Image'] = original['Image']  # Reuse the exact local image, without pulling latest.
    host['Binds'] = list(host.get('Binds') or []) + [f'{SOURCE.as_posix()}:{DESTINATION}:ro']
    config['HostConfig'] = host
    return config


def copy_networks(docker, identifier, original):
    expected = original['NetworkSettings']['Networks']
    current = docker.inspect(identifier)['NetworkSettings']['Networks']
    for name, network in expected.items():
        if name in current:
            continue
        endpoint = {key: copy.deepcopy(network[key])
                    for key in ('Aliases', 'Links', 'DriverOpts', 'GwPriority')
                    if network.get(key) is not None}
        if endpoint.get('Aliases'):
            endpoint['Aliases'] = [alias for alias in endpoint['Aliases']
                                   if alias not in (original['Id'], original['Id'][:12])]
        docker.request('POST', f'/networks/{quote(name, safe="")}/connect',
                       {'Container': identifier, 'EndpointConfig': endpoint})
    for name in current.keys() - expected.keys():
        docker.request('POST', f'/networks/{quote(name, safe="")}/disconnect',
                       {'Container': identifier, 'Force': False})


def check_nginx(identifier):
    result = subprocess.run(['docker', 'exec', identifier, 'nginx', '-t'],
                            capture_output=True, timeout=20)
    if result.returncode:
        raise RuntimeError('Nginx configuration check failed; inspect with docker exec nginx nginx -t.')


class LocalHTTPS(http.client.HTTPSConnection):
    def connect(self):
        connection = socket.create_connection(('127.0.0.1', self.port), self.timeout)
        try:
            self.sock = ssl.create_default_context().wrap_socket(connection, server_hostname=self.host)
        except BaseException:
            connection.close()
            raise


def fetch(site_url, request_path):
    parsed = urlsplit(site_url)
    connection = LocalHTTPS(parsed.hostname, port=parsed.port or 443, timeout=5)
    try:
        connection.request('GET', request_path, headers={'Accept-Encoding': 'identity'})
        response = connection.getresponse()
        return response.status, response.read(8 * 1024 * 1024 + 1)
    finally:
        connection.close()


def verify_site(site_url, expected_hash, baseline_health):
    status, content = fetch(site_url, '/')
    if status != 200 or hashlib.sha256(content).hexdigest() != expected_hash:
        raise RuntimeError('HTTPS homepage does not match the uploaded Hugo homepage.')
    if baseline_health == 200 and fetch(site_url, '/healthz')[0] != 200:
        raise RuntimeError('The previously healthy API health route no longer returns HTTP 200.')


def restore(docker, original_id, replacement_id, failed_name):
    if replacement_id:
        replacement = docker.inspect(replacement_id)
        if replacement['State']['Running']:
            docker.action(replacement_id, 'stop', t=10)
        if replacement['Name'] == '/' + CONTAINER:
            docker.action(replacement_id, 'rename', name=failed_name)
    original = docker.inspect(original_id)
    if original['Name'] != '/' + CONTAINER:
        docker.action(original_id, 'rename', name=CONTAINER)
    if not original['State']['Running']:
        docker.action(original_id, 'start')


def rollout(docker, original, config, backup_name, check, verify):
    replacement_id = None
    try:
        created = docker.request('POST', '/containers/create?' + urlencode({'name': backup_name + '-new'}), config)
        replacement_id = created['Id']
        copy_networks(docker, replacement_id, original)
        docker.action(original['Id'], 'stop', t=15)
        docker.action(original['Id'], 'rename', name=backup_name)
        docker.action(replacement_id, 'rename', name=CONTAINER)
        docker.action(replacement_id, 'start')
        check(replacement_id)
        # Check endpoints once the workers have started, using bounded retries.
        last_error = None
        for attempt in range(3):
            try:
                verify()
                return replacement_id
            except (OSError, http.client.HTTPException, RuntimeError) as error:
                last_error = error
                if attempt < 2:
                    time.sleep(1)
        raise last_error
    except BaseException:
        try:
            restore(docker, original['Id'], replacement_id, backup_name + '-failed')
            print('Original container restored; replacement retained for inspection.')
        except BaseException:
            print(f'Automatic restore could not finish. Original ID: {original["Id"]}; backup: {backup_name}')
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Apply the mount and recreate nginx.')
    parser.add_argument('--site-url', default='https://hornhub.me/')
    args = parser.parse_args()
    parsed = urlsplit(args.site_url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
        parser.error('--site-url must be an HTTPS site root without credentials.')
    if os.geteuid() != 0:
        parser.error('Run with sudo; do not send your sudo password to anyone.')
    docker = Docker()
    original = docker.inspect(CONTAINER)
    if not original['State']['Running']:
        raise RuntimeError('Original nginx is not running; no changes made.')
    for mount in original['Mounts']:
        if mount['Destination'] == DESTINATION:
            if mount.get('Source') == str(SOURCE) and not mount.get('RW', True):
                print('The read-only Ivy mount is already configured; no recreation needed.')
                return
            raise RuntimeError('The web root already has another mount; no changes made.')
    if not (SOURCE / 'index.html').is_file():
        raise RuntimeError('Upload the Hugo site before applying this change.')
    expected_hash = hashlib.sha256((SOURCE / 'index.html').read_bytes()).hexdigest()
    config = build_config(original)
    check_nginx(CONTAINER)
    print(f'Add mount: {SOURCE} -> {DESTINATION} (read-only)')
    print('Preserve networks: ' + ', '.join(original['NetworkSettings']['Networks']))
    print('Preserve the original image ID, configuration, ports, environment and restart policy.')
    if not args.apply:
        print('Preview only; run again with --apply to update the container.')
        return
    os.umask(0o077)
    backup_dir = Path(tempfile.mkdtemp(prefix='ivy-nginx-', dir='/var/backups'))
    snapshot = backup_dir / 'inspect.json'
    snapshot.write_text(json.dumps(original, indent=2), encoding='utf-8')
    backup_name = backup_dir.name
    try:
        baseline_health = fetch(args.site_url, '/healthz')[0]
    except (OSError, http.client.HTTPException):
        baseline_health = None
    print(f'Private inspection backup: {snapshot}')
    print(f'Old container will be retained as: {backup_name}')
    print(f'API baseline health status: {baseline_health}')
    def interrupted(signum, frame):
        raise RuntimeError(f'Interrupted by signal {signum}.')
    for name in ('SIGHUP', 'SIGTERM'):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), interrupted)
    rollout(docker, original, config, backup_name, check_nginx,
            lambda: verify_site(args.site_url, expected_hash, baseline_health))
    print('SUCCESS: HTTPS serves the uploaded Hugo homepage; the old container remains available.')
    if baseline_health != 200:
        print('The API health route was not HTTP 200 before the update; it was not used as a readiness check.')
    print('Manual restore, if needed:')
    print(f'sudo docker stop nginx && sudo docker rename nginx {backup_name}-retired && '
          f'sudo docker rename {backup_name} nginx && sudo docker start nginx')


if __name__ == '__main__':
    try:
        main()
    except (DockerError, RuntimeError, OSError, http.client.HTTPException, subprocess.TimeoutExpired) as error:
        print(f'ERROR: {error}')
        raise SystemExit(1)
