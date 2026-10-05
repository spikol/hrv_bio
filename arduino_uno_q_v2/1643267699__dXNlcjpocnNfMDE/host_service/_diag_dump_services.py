"""One-off diagnostic: dump every GATT service/characteristic a device
exposes. Not part of the service — delete once the Polar H10 GATT
mismatch is understood. Run with: python3 _diag_dump_services.py"""

import asyncio

from bleak import BleakClient, BleakScanner

ADDR = "F3:44:95:80:84:7B"


async def main():
    device = await BleakScanner.find_device_by_address(ADDR, timeout=10.0)
    if device is None:
        print("device not found by address")
        return
    async with BleakClient(device) as client:
        print("connected:", client.is_connected)
        for svc in client.services:
            print("SERVICE", svc.uuid, svc.description)
            for ch in svc.characteristics:
                print("   CHAR", ch.uuid, ch.properties, ch.description)


asyncio.run(main())
