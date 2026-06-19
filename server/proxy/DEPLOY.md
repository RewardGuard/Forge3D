# Forge3D Cloud proxy — deploy on the EC2 box

Holds the AI keys server-side so app users get the **base model** free (no key).

## 1. Copy the proxy to the server
```bash
scp -i ~/.ssh/rewardguard-db-key -r server/proxy ubuntu@3.23.64.187:~/forge3d-proxy
```

## 2. On the server: configure a key + run it
```bash
ssh -i ~/.ssh/rewardguard-db-key ubuntu@3.23.64.187
cd ~/forge3d-proxy
cp .env.example .env && nano .env      # paste at least one *_KEY (GLM/Groq are free)
node --version                          # need 18+. If missing: sudo apt install -y nodejs

# run it under systemd so it survives reboots:
sudo tee /etc/systemd/system/forge3d-proxy.service >/dev/null <<'UNIT'
[Unit]
Description=Forge3D Cloud proxy
After=network.target
[Service]
WorkingDirectory=/home/ubuntu/forge3d-proxy
ExecStart=/usr/bin/node /home/ubuntu/forge3d-proxy/index.mjs
Restart=always
User=ubuntu
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload && sudo systemctl enable --now forge3d-proxy
curl localhost:8787/health        # -> {"ok":true,"provider":"glm","configured":true}
```

## 3. Open the port in the EC2 Security Group
Inbound rule: **Custom TCP 8787** from `0.0.0.0/0` (so the desktop app can reach it).

## 4. Point the app at it (already wired)
The app calls `FORGE3D_PROXY` or defaults to `http://3.23.64.187:8787`.
Users pick **"Forge3D Cloud (base model)"** in Settings — no key needed.
