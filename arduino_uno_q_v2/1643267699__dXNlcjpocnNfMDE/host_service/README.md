# BLE heart-rate host service

`ble_hr_service.py` runs directly on the UNO Q's Debian host — **not** inside
the App Lab container that runs `python/main.py`. App Lab's app containers
have no D-Bus/BlueZ access, so `bleak` can't talk to the Polar H10 from
inside the app. This script runs outside that sandbox (where D-Bus/BlueZ
work natively) and republishes the parsed heart-rate stream over a small
local HTTP endpoint that the containerized app polls instead.

The app auto-detects the host's gateway IP from its own default route, so
no configuration is needed on the app side as long as this service listens
on port 8765 (override with `BLE_HR_SERVICE_HOST` / `BLE_HR_SERVICE_PORT`
env vars on the app side if you change the port here).

## Install (on the board, via SSH)

```sh
pip3 install --break-system-packages bleak
sudo cp host_service/ble-hr-service.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ble-hr-service
```

## Check it

```sh
curl http://localhost:8765/health
curl http://localhost:8765/hr
```

## Logs

```sh
journalctl -u ble-hr-service -f
```

## Why this exists

See the Arduino forum threads on BLE access from App Lab containers — there's
no Bluetooth brick, and app containers don't get a D-Bus socket mounted in.
Running the BlueZ-dependent code on the host and exposing it over HTTP is the
documented workaround.
