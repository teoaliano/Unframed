#!/bin/sh
# The installed Chrome, for a local browser-seam run on a Mac, with its output sent to /dev/null.
#
# Chrome before 148 ignores Playwright's --disable-updater-scheduler: 19 s after launch it starts
# "GoogleUpdater --wake-all" in a process group of its own, and that process keeps Chrome's
# stdout and stderr. Playwright's browser.close() waits until both pipes close, and the worker
# fixture that calls it has no timeout, so a slow update check kept each worker alive for
# minutes after its last test. Keep Chrome off Playwright's pipes. The remote debugging pipes
# (fds 3 and 4) pass through exec untouched, and Chrome closes them for anything it spawns.
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "$@" >/dev/null 2>&1
