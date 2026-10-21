# Hugo 博客 · Elizen 风格 Ivy

本项目使用 Hugo + Ivy 主题开发，提交到 GitHub 的 `main` 分支后，由 GitHub Actions 构建并通过 SSH/rsync 发布到阿里云 ECS，Nginx 直接提供静态文件。

外观适配自 [Elizen](https://elizen.me/) 的定制 Ivy：暖白纸色、顶部导航、衬线大标题、居中阅读栏、日期文章列表与年份归档。保留原 Ivy 子模块，通过项目模板覆盖实现，适配来源见 [主题说明](docs/theme-source.md)。

## 填写自己的内容

- `hugo.yaml`：修改 `title`（站名）、`params.brandNote`（站名旁小字）、`params.description`、`params.footer` 和导航。
- `content/_index.md`：修改 `hero.title`、`hero.emphasis`（标题第二行）、`hero.intro`（介绍）以及 `hero.current`（“现在”栏）。空字段不显示。`latestCount` 控制首页文章数。
- 在 `content/_index.md` 的第二个 `---` 后写 Markdown，可显示首页底部寄语；`noteImage` 可填写自己的图片地址，`noteImageAlt` 填图片说明。不填正文时整块隐藏。
- `content/about.md`：在第二个 `---` 后填写个人简介。
- `content/post/`：存放文章。首页、归档、标签会自动从文章生成。

示例文章 `hello-ivy.md` 已设为草稿，正式构建不发布。无文章时显示空状态，不填充虚构文章。

新增文章后，编辑文件中的 `title`、`description`、`tags` 和正文，将 `draft` 改为 `false` 即可发布。`description` 优先作为首页摘要；留空则自动截取正文。文章可设置 `show_toc: true` 显示目录。文章页面支持代码高亮、图片、引用、表格与前后篇导航。

首页配置示例（填入你自己的文字）：

```yaml
hero:
  eyebrow: PERSONAL NOTES
  title: 我的文字，
  emphasis: 我的生活。
  intro: ''
  currentLabel: 现在
  current: ''
```

## 本地开发

已验证的本地版本：

- Git 2.55+
- Hugo Extended 0.168.0
- Ivy 子模块：`themes/hugo-ivy`

启动开发服务器：

```powershell
git submodule update --init --recursive
hugo server
```

浏览器打开 <http://localhost:1313/>。新增文章：

预览草稿时使用 `hugo server -D`。

```powershell
hugo new content post/my-article.md
```

生产构建：

```powershell
hugo --gc --minify --cleanDestinationDir
```

生成结果在 `public/`，该目录不会提交到 Git。

## NES 游戏页

游戏页为 `/games/`，使用本站自托管的 JSNES 2.1.0。ROM 由站长通过 SSH/SFTP 上传到自己的服务器，网页读取 Nginx 的 JSON 目录列表，自动提供游戏选择。无需增加后台服务或数据库，也不依赖外部 CDN；仓库不附带 ROM。

首次在 ECS 配置目录和 Nginx：

1. 在站点根目录创建真正的 `roms/` 目录，所有者使用实际的 SSH 上传用户。沿用本文的 `deploy` 用户和默认站点目录时：

   ```bash
   sudo install -d -o deploy -g deploy -m 755 /var/www/ivy/roms
   ```

2. 将 `deploy/nginx-roms.conf.example` 上传并保存为 Nginx 配置片段，在**当前提供网站的 `server {}` 内**加入 `include /etc/nginx/snippets/ivy-roms.conf;`。片段继承该站点的 `root`，提供 `/roms/` JSON 列表，只允许读取目录中的直接 `.nes` 文件，拒绝其他文件、子目录和文件软链接。完整 `deploy/nginx-ivy.conf.example` 已内置同样规则，使用完整示例时无需再 include。
3. 检查配置并重载。宿主机 Nginx 使用 `sudo nginx -t`，通过后 `sudo systemctl reload nginx`。已有 Docker Nginx 时，把片段放进现有配置的挂载目录，让 include 路径在**容器内**可见，再运行 `sudo docker exec nginx nginx -t`，通过后 `sudo docker exec nginx nginx -s reload`。保留现有 HTTPS 和其他服务配置。

如果已有 `/var/www/ivy:/usr/share/nginx/html:ro` 挂载，宿主机上传路径 `/var/www/ivy/roms/` 就对应容器内 `/usr/share/nginx/html/roms/`；无需增加挂载或重建容器。若 `ECS_TARGET` 使用其他站点根目录，将上述宿主机路径替换为实际目录，并确保 Nginx 的 `root` 与之对应。

之后添加游戏时，将有权公开分发的、未压缩 iNES `.nes` 文件上传到服务器的 `roms/`，文件名会成为列表中的游戏名。先上传为临时扩展名，完成后在服务器同一目录改名，避免访客读取尚未传完的文件：

```bash
scp game-one.nes deploy@YOUR_ECS_HOST:/var/www/ivy/roms/.game-one.nes.uploading
ssh deploy@YOUR_ECS_HOST 'chmod 644 /var/www/ivy/roms/.game-one.nes.uploading && mv -- /var/www/ivy/roms/.game-one.nes.uploading /var/www/ivy/roms/game-one.nes'
```

也可以用 SFTP 完成上传、权限设置和改名。文件保持 Nginx 可读（通常目录 `755`、文件 `644`），只放在这一层目录。上传、改名或删除后，在游戏页刷新 ROM 列表即可选择，无需修改 YAML、提交 ROM 或重新构建网站。Actions 的 rsync 已排除整个 `/roms/` 目录，后续发布会保留服务器上自行上传的文件。

ROM 限制为 8 MiB，不支持 ZIP、FDS、NES 2.0；部分映射器可能不兼容。也可以用“打开本地 ROM”直接玩电脑上的文件：只在浏览器中读取，不会上传。`hugo server` 不提供 Nginx JSON 目录列表，本地预览时可使用这个入口。

点击游戏画面后，方向键或 WASD 移动，X=A、Z=B、Enter=Start、Shift=Select、空格=暂停。手机显示触控手柄。支持暂停/继续、重新开始、声音开关和浏览器支持时的全屏；切换窗口或隐藏页面会自动暂停。默认静音，不自动启动游戏，暂不持久保存游戏进度。

服务器 `roms/` 只用于可公开分发的 ROM，目录本身不要使用软链接；文件名、大小、修改时间和 ROM 下载均对访客公开。不要放入密钥、配置或其他私有文件；本地 `.nes`、`.rom` 文件也已被 Git 忽略，防止误提交。需要只在自己浏览器中读取时，使用本地 ROM 入口。

目录列表使用 Nginx 官方 [autoindex JSON 格式](https://nginx.org/en/docs/http/ngx_http_autoindex_module.html#autoindex_format)，文件访问限制见 [Nginx 核心模块文档](https://nginx.org/en/docs/http/ngx_http_core_module.html#location)。

运行测试：`node --test tests/nes-player.test.cjs`。测试只使用自写的合成 ROM，不包含商业游戏内容。

## 页脚备案号（私有配置）

公共配置 `hugo.yaml` 中的 `params.icp` 默认留空；未配置时，不显示备案栏。

本地在 `config/_default/params.yaml` 设置 `icp`，Hugo 会自动合并该配置，`hugo server` 无需额外参数：

```yaml
icp: '' # 填写自己的完整 ICP 备案号
```

该文件已被 Git 忽略，不要强制提交。线上在 GitHub Actions 的仓库 Secrets 中设置 `ICP_NUMBER`，构建步骤会通过 `HUGO_PARAMS_ICP` 覆盖同一个配置项。修改本地配置后，需自行同步更新 Secret。

备案号在全站页脚底部居中显示，并链接工信部备案管理系统。此设置只避免号码进入开源源码和明文构建日志；网站 HTML 中的备案号仍是公开可见的。

## 首次连接 GitHub

先在 GitHub 创建一个空仓库，然后执行：

```powershell
git add .
git commit -m "Initialize Hugo Ivy site"
git remote add origin https://github.com/YOUR_NAME/YOUR_REPO.git
git push -u origin main
```

注意：Ivy 是 Git submodule。不要只复制 `themes/hugo-ivy` 的工作区文件；Actions 会根据 `.gitmodules` 自动拉取它。

## ECS 一次性配置

如果服务器已经通过 Docker 运行 Nginx，请沿用现有容器。本站目录需要以只读方式挂载到容器内的网页目录，例如 `/var/www/ivy:/usr/share/nginx/html:ro`。本项目的 `deploy/add-ivy-nginx-mount.py` 可用于当前直接通过 Docker 启动的 `nginx` 容器：它保留镜像、端口、配置、环境变量和网络，保留旧容器，并在配置或 HTTPS 检查失败时尝试恢复。先使用 `sudo python3 add-ivy-nginx-mount.py` 预览，确认后添加 `--apply`；它不适用于 Compose 管理或显式静态容器 IP 的场景。更新时会短暂中断 Web 服务，完整容器备份只保存在服务器 `/var/backups/ivy-nginx-*` 的 root 私有目录。

以下宿主机安装示例仅适用于尚未运行 Nginx 的服务器。

以下示例适用于 Ubuntu/Debian。先准备一个专用部署公钥，然后登录 ECS 执行：

```bash
sudo apt update
sudo apt install -y nginx rsync
sudo adduser --disabled-password --gecos '' deploy
sudo install -d -o deploy -g deploy -m 755 /var/www/ivy
sudo install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
sudo sh -c 'printf "%s\n" "YOUR_DEPLOY_PUBLIC_KEY" > /home/deploy/.ssh/authorized_keys'
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

把 `deploy/nginx-ivy.conf.example` 上传到 ECS，替换其中域名后启用：

```bash
sudo cp nginx-ivy.conf.example /etc/nginx/sites-available/ivy
sudo ln -s /etc/nginx/sites-available/ivy /etc/nginx/sites-enabled/ivy
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

在阿里云安全组中开放 TCP 80；启用 HTTPS 后再开放 TCP 443。不要向公网开放不需要的端口。

## GitHub Actions 配置

在仓库 `Settings > Environments` 创建 `production` 环境，然后在 `Settings > Secrets and variables > Actions` 设置：

Variables：

| 名称 | 示例 | 说明 |
| --- | --- | --- |
| `SITE_URL` | `https://example.com/` | 站点正式地址，建议以 `/` 结尾 |

Secrets：

| 名称 | 内容 |
| --- | --- |
| `ECS_HOST` | ECS 公网 IP 或域名 |
| `ECS_PORT` | SSH 端口，未设置时默认 22 |
| `ECS_USER` | 部署用户 |
| `ECS_TARGET` | Nginx 站点目录，未设置时默认 `/var/www/ivy/` |
| `ECS_SSH_KEY` | 与 ECS 上部署公钥配对的私钥全文 |
| `ECS_KNOWN_HOSTS` | ECS 的 SSH host key 记录 |

这六项 Secrets 只在部署步骤中注入，避免在构建步骤的日志中出现连接参数。`SITE_URL` 是公开站点地址，保留为 Variable。本地 `.env` 不会随 Git 提交，也不会自动更新 GitHub Secrets；修改后需同步修改对应的 Secret。

另可设置 `ICP_NUMBER` Secret 用于页脚备案号，仅在构建步骤中注入，详见上文的私有配置说明。

获取 `ECS_KNOWN_HOSTS` 前，应先在 ECS 控制台终端执行 `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` 查看可信指纹，再在本机运行 `ssh-keyscan -p 22 YOUR_ECS_HOST`，确认指纹一致后把整行结果保存为 Secret。

完成后，每次推送到 `main` 都会执行：拉取代码与主题 → Hugo 构建 → rsync 到 `/var/www/ivy/` → Nginx 自动展示新版本。

## 开发入口

- 站点配置：`hugo.yaml`
- Markdown：`content/`
- 主题样式：`assets/css/custom.css`
- 本站适配样式：`assets/css/site.css`（自动合并、压缩并添加缓存指纹）
- 主题模板覆盖：`layouts/`
- 自动部署：`.github/workflows/deploy.yml`
- Nginx 示例：`deploy/nginx-ivy.conf.example`
- 现有 Nginx 的 ROM 列表配置片段：`deploy/nginx-roms.conf.example`

升级主题前先预览差异：

```powershell
git -C themes/hugo-ivy fetch origin
git -C themes/hugo-ivy log --oneline HEAD..origin/master
```

确认后再更新并提交子模块指针：

```powershell
git -C themes/hugo-ivy pull --ff-only origin master
git add themes/hugo-ivy
git commit -m "Update Hugo Ivy theme"
```
