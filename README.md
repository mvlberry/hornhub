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
| `ECS_HOST` | `203.0.113.10` | ECS 公网 IP 或域名 |
| `ECS_PORT` | `22` | SSH 端口，可不填，默认 22 |
| `ECS_USER` | `deploy` | 专用部署用户 |
| `ECS_TARGET` | `/var/www/ivy/` | Nginx 站点目录，可不填 |

Secrets：

| 名称 | 内容 |
| --- | --- |
| `ECS_SSH_KEY` | 与 ECS 上部署公钥配对的私钥全文 |
| `ECS_KNOWN_HOSTS` | ECS 的 SSH host key 记录 |

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
