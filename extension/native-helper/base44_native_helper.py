#!/usr/bin/env python3
"""
Base44 Bridge Native Messaging Helper
======================================
Receives commands from the Chrome Extension via Native Messaging
(stdin/stdout with 4-byte length prefix) and performs OS-level operations
that Chrome Extensions cannot do:
  - Save files from base64 to TEMP
  - Put text/paths in Windows clipboard
  - Send keystrokes (Ctrl+V, Enter) to focused window (e.g. WA file dialog)
  - Wait for Windows file dialog + inject path via WM_SETTEXT

This replicates the VBA+Selenium approach used by WhatsApp Blaster to
attach PDFs/documents to WhatsApp Web messages.

Requires on target machine: Python 3.8+ with packages:
    pywin32 pyautogui
"""
import sys
import os
import json
import struct
import base64
import tempfile
import time
import traceback

# Windows-only imports (lazy to allow script to at least start on other OSes)
try:
    import win32clipboard
    import win32con
    import pyautogui
    import ctypes
    # Enable per-monitor DPI awareness so pyautogui coords match Chrome's logical pixels.
    # Without this, clicks miss on high-DPI / scaled displays (125%, 150%, etc.)
    try:
        # Try the newest API first (Windows 10 1703+)
        ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PER_MONITOR_AWARE_V2
    except Exception:
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(1)  # PER_MONITOR_AWARE
        except Exception:
            try:
                ctypes.windll.user32.SetProcessDPIAware()  # Legacy
            except Exception:
                pass
    pyautogui.FAILSAFE = False  # prevent corner-abort when cursor reaches screen edge
    WIN_READY = True
except ImportError as e:
    WIN_READY = False
    IMPORT_ERROR = str(e)


# --- Native Messaging protocol: 4-byte length prefix + JSON ---
def send_message(obj):
    try:
        data = json.dumps(obj).encode('utf-8')
        sys.stdout.buffer.write(struct.pack('<I', len(data)))
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
    except Exception:
        pass


def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    length = struct.unpack('<I', raw_length)[0]
    if length == 0 or length > 20 * 1024 * 1024:
        return None
    data = sys.stdin.buffer.read(length).decode('utf-8')
    return json.loads(data)


# --- Basic actions ---
def action_ping(msg):
    return {
        'success': True,
        'pong': True,
        'version': '1.2.1',
        'python': sys.version.split()[0],
        'win_ready': WIN_READY
    }


def action_save_file(msg):
    """Decode base64 and save to TEMP. Returns the full path."""
    b64 = msg.get('file_base64', '')
    filename = msg.get('filename', 'attachment.bin')
    filename = os.path.basename(filename).replace('\\', '').replace('/', '')
    if not filename:
        filename = 'attachment.bin'

    if not b64:
        return {'success': False, 'error': 'missing file_base64'}

    try:
        data = base64.b64decode(b64)
    except Exception as e:
        return {'success': False, 'error': f'base64 decode failed: {e}'}

    tmp_dir = os.path.join(tempfile.gettempdir(), 'base44_bridge')
    os.makedirs(tmp_dir, exist_ok=True)
    file_path = os.path.join(tmp_dir, filename)

    with open(file_path, 'wb') as f:
        f.write(data)

    return {
        'success': True,
        'file_path': file_path,
        'size': len(data)
    }


def _set_clipboard_text(text):
    """Put Unicode text into Windows clipboard."""
    win32clipboard.OpenClipboard()
    try:
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardData(win32con.CF_UNICODETEXT, text)
    finally:
        win32clipboard.CloseClipboard()


def action_paste_path(msg):
    """Legacy path: put in clipboard, Ctrl+V + Enter to focused window."""
    if not WIN_READY:
        return {'success': False, 'error': f'windows libs unavailable: {IMPORT_ERROR}'}

    path = msg.get('file_path', '')
    if not path or not os.path.exists(path):
        return {'success': False, 'error': f'file not found: {path}'}

    pre_delay = float(msg.get('pre_delay_ms', 500)) / 1000.0
    time.sleep(pre_delay)

    try:
        _set_clipboard_text(path)
    except Exception as e:
        return {'success': False, 'error': f'clipboard failed: {e}'}

    time.sleep(0.2)

    try:
        pyautogui.hotkey('ctrl', 'v')
        time.sleep(0.3)
        pyautogui.press('enter')
    except Exception as e:
        return {'success': False, 'error': f'sendkeys failed: {e}'}

    return {'success': True}


def action_attach_full(msg):
    """Combined: save + wait + paste+enter."""
    saved = action_save_file(msg)
    if not saved.get('success'):
        return saved

    delay_ms = int(msg.get('wait_before_paste_ms', 800))
    time.sleep(delay_ms / 1000.0)

    pasted = action_paste_path({
        'file_path': saved['file_path'],
        'pre_delay_ms': 0
    })

    return {
        'success': pasted.get('success', False),
        'file_path': saved['file_path'],
        'size': saved['size'],
        'error': pasted.get('error')
    }


# --- v4.5: wait_and_paste with WM_SETTEXT + BM_CLICK ---

def _log_wait(message):
    """Write to diagnostic log."""
    try:
        log_path = os.path.join(tempfile.gettempdir(), 'base44_bridge_wait_and_paste.log')
        with open(log_path, 'a', encoding='utf-8') as f:
            f.write(f'[{time.strftime("%H:%M:%S")}] {message}\n')
    except Exception:
        pass


def _force_foreground(hwnd):
    """Bypass Windows foreground-window lock via AttachThreadInput + Alt tap."""
    import ctypes
    import win32gui
    import win32con
    import win32process
    import win32api

    user32 = ctypes.windll.user32

    try:
        # 0x12 = VK_MENU (Alt)
        user32.keybd_event(0x12, 0, 0, 0)
        time.sleep(0.02)
        user32.keybd_event(0x12, 0, 0x0002, 0)
    except Exception:
        pass

    try:
        fg_hwnd = win32gui.GetForegroundWindow()
        if fg_hwnd and fg_hwnd != hwnd:
            fg_thread = win32process.GetWindowThreadProcessId(fg_hwnd)[0]
            our_thread = win32api.GetCurrentThreadId()
            if fg_thread != our_thread:
                user32.AttachThreadInput(fg_thread, our_thread, True)
                try:
                    win32gui.BringWindowToTop(hwnd)
                    win32gui.SetForegroundWindow(hwnd)
                    user32.SetFocus(hwnd)
                finally:
                    user32.AttachThreadInput(fg_thread, our_thread, False)
                return
    except Exception:
        pass

    try:
        win32gui.ShowWindow(hwnd, win32con.SW_SHOW)
        win32gui.SetForegroundWindow(hwnd)
    except Exception:
        pass


def _find_file_name_edit(dialog_hwnd):
    """Find the 'File name:' Edit control inside #32770."""
    import win32gui

    edits = []

    def _enum_all(parent):
        try:
            def _cb(child_hwnd, _):
                try:
                    cls = win32gui.GetClassName(child_hwnd)
                    if cls == 'Edit':
                        edits.append(child_hwnd)
                    elif cls in ('ComboBoxEx32', 'ComboBox', '#32770', 'DUIViewWndClassName',
                                 'DirectUIHWND', 'CtrlNotifySink', 'FloatNotifySink'):
                        _enum_all(child_hwnd)
                except Exception:
                    pass
                return True
            win32gui.EnumChildWindows(parent, _cb, None)
        except Exception:
            pass

    _enum_all(dialog_hwnd)
    _log_wait(f'_find_file_name_edit: found {len(edits)} Edit controls')

    for e in edits:
        try:
            if win32gui.IsWindowVisible(e) and win32gui.IsWindowEnabled(e):
                return e
        except Exception:
            continue
    return edits[0] if edits else None


def _send_wm_settext(hwnd, text):
    """Send WM_SETTEXT directly to a control (unicode)."""
    import ctypes
    WM_SETTEXT = 0x000C
    ctypes.windll.user32.SendMessageW(hwnd, WM_SETTEXT, 0, ctypes.c_wchar_p(text))


def _get_wm_gettext(hwnd, max_len=2048):
    """Read current text of a control via WM_GETTEXT (unicode)."""
    import ctypes
    WM_GETTEXT = 0x000D
    buf = ctypes.create_unicode_buffer(max_len)
    ctypes.windll.user32.SendMessageW(hwnd, WM_GETTEXT, max_len, ctypes.byref(buf))
    return buf.value


def _find_open_button(dialog_hwnd):
    """Find the Open/Save accept button in a file dialog."""
    import win32gui
    import ctypes

    buttons = []

    def _cb(child_hwnd, _):
        try:
            cls = win32gui.GetClassName(child_hwnd)
            if cls == 'Button':
                text = win32gui.GetWindowText(child_hwnd)
                buttons.append((child_hwnd, text))
        except Exception:
            pass
        return True

    try:
        win32gui.EnumChildWindows(dialog_hwnd, _cb, None)
    except Exception:
        pass

    _log_wait(f'_find_open_button: found {len(buttons)} buttons: {buttons[:10]}')

    accept_labels = {
        'open', '&open', 'פתח', 'פתיחה', '&פתח',
        'save', '&save', 'שמור', '&שמור',
        'ok', '&ok',
        'select', '&select'
    }

    for hwnd, text in buttons:
        if not text:
            continue
        lower = text.lower().strip()
        if lower in accept_labels:
            try:
                if win32gui.IsWindowVisible(hwnd) and win32gui.IsWindowEnabled(hwnd):
                    _log_wait(f'found accept button by label: hwnd={hwnd} "{text}"')
                    return hwnd
            except Exception:
                pass

    GWL_STYLE = -16
    BS_DEFPUSHBUTTON = 0x01
    for hwnd, text in buttons:
        try:
            if not (win32gui.IsWindowVisible(hwnd) and win32gui.IsWindowEnabled(hwnd)):
                continue
            style = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_STYLE)
            if style & BS_DEFPUSHBUTTON:
                _log_wait(f'found default push button: hwnd={hwnd} "{text}"')
                return hwnd
        except Exception:
            continue

    for hwnd, text in buttons:
        try:
            if win32gui.IsWindowVisible(hwnd) and win32gui.IsWindowEnabled(hwnd) and text.strip():
                _log_wait(f'fallback first visible button: hwnd={hwnd} "{text}"')
                return hwnd
        except Exception:
            continue

    return None


def _click_button_bm_click(button_hwnd):
    """Send BM_CLICK to a button (as if user clicked it)."""
    import ctypes
    BM_CLICK = 0x00F5
    ctypes.windll.user32.SendMessageW(button_hwnd, BM_CLICK, 0, 0)


def _confirm_dialog(dialog_hwnd):
    """Click Open/Save button or press Enter to confirm the dialog."""
    import win32gui

    # Method 1: BM_CLICK on accept button
    try:
        open_btn = _find_open_button(dialog_hwnd)
        if open_btn:
            _click_button_bm_click(open_btn)
            _log_wait(f'BM_CLICK sent to button hwnd={open_btn}')
            time.sleep(0.6)
            try:
                still_visible = win32gui.IsWindow(dialog_hwnd) and win32gui.IsWindowVisible(dialog_hwnd)
                _log_wait(f'dialog still visible after BM_CLICK: {still_visible}')
                if not still_visible:
                    return 'BM_CLICK'
            except Exception as e:
                _log_wait(f'visibility check failed: {e}')
                return 'BM_CLICK'
    except Exception as e:
        _log_wait(f'BM_CLICK method failed: {e}')

    # Method 2: Enter key on foregrounded dialog
    try:
        try:
            win32gui.SetForegroundWindow(dialog_hwnd)
        except Exception:
            pass
        time.sleep(0.2)
        pyautogui.press('enter')
        _log_wait('Enter key sent as fallback')
        time.sleep(0.4)
        return 'Enter'
    except Exception as e:
        _log_wait(f'Enter fallback failed: {e}')
        return 'FAILED'


_wait_and_paste_busy = False


def action_wait_and_paste(msg):
    """
    Wait for a Windows file dialog (#32770) to appear, then inject the file
    path directly via WM_SETTEXT and click the Open button via BM_CLICK.

    CONCURRENCY GUARD: only one instance may run at a time. Second call
    returns immediately with error to prevent double-attachment bug.
    """
    global _wait_and_paste_busy
    if _wait_and_paste_busy:
        _log_wait('=== REJECTED: another wait_and_paste already running ===')
        return {
            'success': False,
            'error': 'busy: another wait_and_paste is already running',
            'error_code': 'BUSY'
        }
    _wait_and_paste_busy = True
    try:
        return _action_wait_and_paste_inner(msg)
    finally:
        _wait_and_paste_busy = False


def _action_wait_and_paste_inner(msg):
    if not WIN_READY:
        return {'success': False, 'error': f'windows libs unavailable: {IMPORT_ERROR}'}

    path = msg.get('file_path', '')
    if not path or not os.path.exists(path):
        return {'success': False, 'error': f'file not found: {path}'}

    timeout_s = float(msg.get('timeout_s', 20))

    _log_wait('=== wait_and_paste START ===')
    _log_wait(f'path: {path}')
    _log_wait(f'timeout: {timeout_s}s')

    try:
        import win32gui
        import win32con
    except ImportError as e:
        _log_wait(f'win32gui/con missing: {e}')
        return {'success': False, 'error': f'win32gui missing: {e}'}

    # Initial clipboard set (in case WM_SETTEXT fails, Ctrl+V fallback has data)
    try:
        _set_clipboard_text(path)
        _log_wait('initial clipboard set OK')
    except Exception as e:
        _log_wait(f'initial clipboard FAIL: {e}')
        return {'success': False, 'error': f'clipboard failed: {e}'}

    # Enumerate existing dialogs
    def enum_file_dialogs():
        found = []

        def _cb(hwnd, _):
            try:
                if not win32gui.IsWindowVisible(hwnd):
                    return True
                cls = win32gui.GetClassName(hwnd)
                if cls == '#32770':
                    title = win32gui.GetWindowText(hwnd)
                    found.append((hwnd, title))
            except Exception:
                pass
            return True

        try:
            win32gui.EnumWindows(_cb, None)
        except Exception as e:
            _log_wait(f'EnumWindows failed: {e}')
        return found

    baseline = {h for h, _ in enum_file_dialogs()}
    _log_wait(f'baseline dialogs: {len(baseline)} existing #32770 windows')

    initial_hwnd = win32gui.GetForegroundWindow()
    initial_title = win32gui.GetWindowText(initial_hwnd) if initial_hwnd else ''
    _log_wait(f'initial foreground: hwnd={initial_hwnd} "{initial_title}"')

    start = time.time()
    poll_interval = 0.2
    attempts = 0
    last_diag_log = 0

    while time.time() - start < timeout_s:
        attempts += 1
        current_dialogs = enum_file_dialogs()
        new_dialogs = [(h, t) for h, t in current_dialogs if h not in baseline]

        if time.time() - last_diag_log > 2:
            fg = win32gui.GetForegroundWindow()
            fg_title = win32gui.GetWindowText(fg) if fg else ''
            fg_class = win32gui.GetClassName(fg) if fg else ''
            _log_wait(
                f'poll #{attempts}: foreground=hwnd={fg} class="{fg_class}" '
                f'title="{fg_title}" | #32770 total={len(current_dialogs)} new={len(new_dialogs)}'
            )
            last_diag_log = time.time()

        candidate = None
        if new_dialogs:
            candidate = new_dialogs[-1]
        else:
            fg = win32gui.GetForegroundWindow()
            if fg:
                try:
                    if win32gui.GetClassName(fg) == '#32770':
                        candidate = (fg, win32gui.GetWindowText(fg))
                        _log_wait(f'using foreground as fallback: hwnd={fg}')
                except Exception:
                    pass

        if candidate:
            hwnd, title = candidate
            _log_wait(f'>>> DIALOG FOUND: hwnd={hwnd} title="{title}"')

            time.sleep(0.5)

            try:
                _force_foreground(hwnd)
                _log_wait('force_foreground done')
            except Exception as e:
                _log_wait(f'force_foreground non-fatal: {e}')

            time.sleep(0.3)

            # Strategy A: WM_SETTEXT to the File name Edit control
            strategy_used = None
            try:
                edit_hwnd = _find_file_name_edit(hwnd)
                _log_wait(f'file_name edit: {edit_hwnd}')
                if edit_hwnd:
                    _send_wm_settext(edit_hwnd, path)
                    _log_wait(f'WM_SETTEXT sent to edit={edit_hwnd}')
                    time.sleep(0.3)
                    actual = _get_wm_gettext(edit_hwnd)
                    _log_wait(f'edit text verify: "{actual}"')
                    if actual and path.lower() in actual.lower():
                        strategy_used = 'WM_SETTEXT'
            except Exception as e:
                _log_wait(f'WM_SETTEXT strategy failed: {e}')

            # Strategy B: Clipboard + Ctrl+V fallback
            if not strategy_used:
                _log_wait('falling back to clipboard + Ctrl+V')
                try:
                    _set_clipboard_text(path)
                    _log_wait('clipboard re-set OK')
                except Exception as e:
                    _log_wait(f'clipboard re-set FAIL: {e}')

                time.sleep(0.25)
                try:
                    pyautogui.hotkey('ctrl', 'v')
                    _log_wait('Ctrl+V sent')
                    time.sleep(0.4)
                    strategy_used = 'Ctrl+V'
                except Exception as e:
                    _log_wait(f'Ctrl+V FAIL: {e}')

            # Strategy C: typewrite last resort
            if not strategy_used:
                _log_wait('falling back to typewrite')
                try:
                    pyautogui.hotkey('ctrl', 'a')
                    time.sleep(0.1)
                    pyautogui.press('delete')
                    time.sleep(0.1)
                    pyautogui.typewrite(path, interval=0.01)
                    _log_wait('typewrite done')
                    strategy_used = 'typewrite'
                except Exception as e:
                    _log_wait(f'typewrite FAIL: {e}')
                    return {'success': False, 'error': f'all strategies failed: {e}'}

            # Confirm: BM_CLICK on Open button (not Enter keyboard)
            time.sleep(0.35)
            confirm_method = _confirm_dialog(hwnd)
            _log_wait(f'confirm_method: {confirm_method}')

            _log_wait(f'=== wait_and_paste SUCCESS ({strategy_used} + {confirm_method}) in {round(time.time() - start, 2)}s ===')
            return {
                'success': True,
                'dialog_title': title,
                'dialog_hwnd': hwnd,
                'strategy': strategy_used,
                'confirm_method': confirm_method,
                'waited_s': round(time.time() - start, 2),
                'attempts': attempts
            }

        time.sleep(poll_interval)

    _log_wait(f'=== wait_and_paste TIMEOUT after {attempts} attempts ===')
    return {
        'success': False,
        'error': f'no file dialog appeared within {timeout_s}s',
        'initial_title': initial_title,
        'attempts': attempts,
        'log_path': os.path.join(tempfile.gettempdir(), 'base44_bridge_wait_and_paste.log')
    }



def action_click_at_screen(msg):
    """
    Perform an OS-level mouse click at given screen coordinates.
    Satisfies Chrome's user activation requirement for file pickers.
    Handles DPI scaling: client sends CSS-pixel coords + devicePixelRatio,
    we multiply to physical pixels for SetCursorPos/SendInput.
    """
    _log_wait('=== click_at_screen START ===')
    if not WIN_READY:
        _log_wait(f'not ready: {IMPORT_ERROR}')
        return {'success': False, 'error': f'windows libs unavailable: {IMPORT_ERROR}'}

    try:
        raw_x = float(msg.get('x', 0))
        raw_y = float(msg.get('y', 0))
        dpr = float(msg.get('device_pixel_ratio', 1.0))
    except Exception as e:
        return {'success': False, 'error': f'bad coords: {e}'}

    if raw_x <= 0 or raw_y <= 0:
        return {'success': False, 'error': f'invalid coords: ({raw_x},{raw_y})'}

    # Convert CSS pixels -> physical pixels for pyautogui
    x = int(round(raw_x * dpr))
    y = int(round(raw_y * dpr))

    _log_wait(f'raw=({raw_x:.1f},{raw_y:.1f}) dpr={dpr} physical=({x},{y})')

    # Log screen size for diagnostics
    try:
        import win32api
        sw = win32api.GetSystemMetrics(0)
        sh = win32api.GetSystemMetrics(1)
        _log_wait(f'virtual screen: {sw}x{sh}')
    except Exception:
        pass

    # Save current mouse pos so we can restore it
    try:
        import win32api
        orig_x, orig_y = win32api.GetCursorPos()
        _log_wait(f'original cursor: ({orig_x},{orig_y})')
    except Exception:
        orig_x, orig_y = None, None

    try:
        time.sleep(0.2)
        import win32api as wa

        # Screen dimensions for normalized absolute coords (0-65535 range)
        screen_w = wa.GetSystemMetrics(0)
        screen_h = wa.GetSystemMetrics(1)
        if screen_w <= 0 or screen_h <= 0:
            return {'success': False, 'error': f'bad screen size: {screen_w}x{screen_h}'}

        nx = int(round(x * 65535 / screen_w))
        ny = int(round(y * 65535 / screen_h))
        _log_wait(f'normalized (0-65535): ({nx},{ny}) for screen {screen_w}x{screen_h}')

        # FIX: Chrome needs WM_MOUSEMOVE before click to update hover/focus state.
        # SetCursorPos alone does NOT generate WM_MOUSEMOVE. We use mouse_event with
        # MOUSEEVENTF_MOVE|ABSOLUTE to generate a proper move event.
        MOUSEEVENTF_MOVE = 0x0001
        MOUSEEVENTF_ABSOLUTE = 0x8000
        MOUSEEVENTF_LEFTDOWN = 0x0002
        MOUSEEVENTF_LEFTUP = 0x0004

        # Pre-move the cursor visually too (SetCursorPos) so user sees it going
        wa.SetCursorPos((x, y))
        time.sleep(0.05)

        # Send proper MOVE event (triggers WM_MOUSEMOVE -> hover state updates)
        wa.mouse_event(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, nx, ny, 0, 0)
        time.sleep(0.15)  # let Chrome process hover + render any hover styling
        _log_wait('MOVE event sent (ABSOLUTE), waiting for hover update')

        # Now click
        wa.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        time.sleep(0.04)
        wa.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        _log_wait('LEFTDOWN+LEFTUP sent')

        # Verify cursor final position
        try:
            actual_x, actual_y = wa.GetCursorPos()
            _log_wait(f'cursor after click: ({actual_x},{actual_y}) vs target=({x},{y})')
            if abs(actual_x - x) > 5 or abs(actual_y - y) > 5:
                _log_wait(f'⚠ cursor landed {abs(actual_x - x)}px,{abs(actual_y - y)}px off target')
        except Exception:
            pass
    except Exception as e:
        _log_wait(f'click FAIL: {e}')
        return {'success': False, 'error': f'click failed: {e}'}

    # Restore cursor position
    restore = bool(msg.get('restore_cursor', True))
    if restore and orig_x is not None:
        try:
            time.sleep(0.08)
            import win32api
            win32api.SetCursorPos((orig_x, orig_y))
            _log_wait(f'cursor restored to ({orig_x},{orig_y})')
        except Exception as e:
            _log_wait(f'cursor restore failed: {e}')

    _log_wait('=== click_at_screen SUCCESS ===')
    return {
        'success': True,
        'clicked_css': [raw_x, raw_y],
        'clicked_physical': [x, y],
        'device_pixel_ratio': dpr,
        'restored_cursor': restore
    }


def action_cleanup(msg):
    """Delete temp files created by this helper."""
    tmp_dir = os.path.join(tempfile.gettempdir(), 'base44_bridge')
    removed = 0
    if os.path.exists(tmp_dir):
        for f in os.listdir(tmp_dir):
            try:
                os.remove(os.path.join(tmp_dir, f))
                removed += 1
            except Exception:
                pass
    return {'success': True, 'removed': removed}


ACTIONS = {
    'ping': action_ping,
    'save_file': action_save_file,
    'paste_path': action_paste_path,
    'wait_and_paste': action_wait_and_paste,
    'attach_full': action_attach_full,
    'click_at_screen': action_click_at_screen,
    'cleanup': action_cleanup,
}


def main():
    max_idle_reads = 3
    idle_reads = 0

    while True:
        try:
            msg = read_message()
        except Exception as e:
            send_message({'success': False, 'error': f'read failed: {e}'})
            idle_reads += 1
            if idle_reads > max_idle_reads:
                break
            continue

        if msg is None:
            break
        idle_reads = 0

        action = msg.get('action', '')
        handler = ACTIONS.get(action)

        try:
            if handler:
                result = handler(msg)
            else:
                result = {'success': False, 'error': f'unknown action: {action}'}
        except Exception as e:
            result = {
                'success': False,
                'error': str(e),
                'trace': traceback.format_exc()
            }

        if not isinstance(result, dict):
            result = {'success': False, 'error': 'handler returned non-dict'}

        if 'request_id' in msg:
            result['request_id'] = msg['request_id']

        send_message(result)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        try:
            log_path = os.path.join(tempfile.gettempdir(), 'base44_bridge_native.log')
            with open(log_path, 'a', encoding='utf-8') as f:
                f.write(f'[{time.strftime("%Y-%m-%d %H:%M:%S")}] FATAL: {e}\n')
                f.write(traceback.format_exc())
                f.write('\n')
        except Exception:
            pass
