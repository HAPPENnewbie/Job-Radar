# Job-Radar Ubuntu 部署文档

本文档用于在 Ubuntu 服务器上部署 Job-Radar 项目。项目采用 Flask + SQLite，部署方式为 Gunicorn + systemd。

## 1. 创建项目目录

```bash
mkdir -p /home/ubuntu/python_project
cd /home/ubuntu/python_project
```

## 2. 拉取 Git 项目

```bash
git clone https://github.com/HAPPENnewbie/Job-Radar.git
cd Job-Radar
```

如果项目已经存在，更新代码即可：

```bash
cd /home/ubuntu/python_project/Job-Radar
git pull
```

## 3. 创建虚拟环境

```bash
cd /home/ubuntu/python_project/Job-Radar
python3 -m venv .venv
source .venv/bin/activate
```

## 4. 安装依赖

确认项目根目录存在 `requirements.txt`：

```txt
Flask==3.0.3
gunicorn==22.0.0
```

安装依赖：

```bash
pip install -r requirements.txt
```

## 5. 测试启动

```bash
cd /home/ubuntu/python_project/Job-Radar
source .venv/bin/activate
gunicorn -w 2 -b 0.0.0.0:5001 app:app
```

浏览器访问：

```text
http://服务器IP:5001
```

测试正常后，在终端按 `Ctrl + C` 停止服务。

## 6. 创建 systemd 服务

```bash
sudo nano /etc/systemd/system/job-radar.service
```

写入以下内容：

```ini
[Unit]
Description=Job Radar Flask App
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/python_project/Job-Radar
Environment="PATH=/home/ubuntu/python_project/Job-Radar/.venv/bin"
ExecStart=/home/ubuntu/python_project/Job-Radar/.venv/bin/gunicorn -w 2 -b 0.0.0.0:5001 app:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

保存并退出：

```text
Ctrl + O
Enter
Ctrl + X
```

## 7. 启动服务

```bash
sudo systemctl daemon-reload
sudo systemctl start job-radar
sudo systemctl enable job-radar
```

## 8. 查看服务状态

```bash
sudo systemctl status job-radar
```

看到 `active (running)` 表示启动成功。

## 9. 常用命令

重启服务：

```bash
sudo systemctl restart job-radar
```

停止服务：

```bash
sudo systemctl stop job-radar
```

查看状态：

```bash
sudo systemctl status job-radar
```

查看日志：

```bash
journalctl -u job-radar -f
```

## 10. 更新项目

```bash
cd /home/ubuntu/python_project/Job-Radar
git pull
source .venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart job-radar
```

## 11. 访问项目

```text
http://服务器IP:5001
```

如果云服务器访问不了，需要在服务器安全组中开放 `5001` 端口。