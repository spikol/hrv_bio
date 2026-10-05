import asyncio
import threading
import time

from arduino.app_utils import App

from polar_hrv_display import run as run_hrv_display


def start_hrv_display():
    """Runs the BLE/HRV/LED pipeline on its own event loop in a background
    thread, since App.run's user_loop is a plain sync callback."""
    try:
        asyncio.run(run_hrv_display())
    except Exception as exc:
        print(f"polar_hrv_display stopped: {exc}")


threading.Thread(target=start_hrv_display, daemon=True).start()


def loop():
    """This function is called repeatedly by the App framework."""
    time.sleep(10)


# See: https://docs.arduino.cc/software/app-lab/tutorials/getting-started/#app-run
App.run(user_loop=loop)
