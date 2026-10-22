"""Explicit demo initialization and loopback-only development serving."""
import argparse
import json
import os
from pathlib import Path
import secrets
import sys
import threading

from .app import create_app, seed_demo_users
from .paths import RUNTIME


def main():
    parser = argparse.ArgumentParser(description='鑫金源 ERP/出纳独立虚构开发版')
    parser.add_argument('--root', type=Path, default=RUNTIME / 'demo')
    parser.add_argument('--port', type=int, default=31841)
    parser.add_argument('--demo-init', action='store_true', help='显式建立全新虚构人员；拒绝覆盖已有账户')
    parser.add_argument('--init-only', action='store_true', help='只初始化，不启动服务')
    parser.add_argument('--parent-watch', action='store_true', help='仅开发桌面子进程：stdin管道关闭后正常停止本服务')
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error('端口须为1024至65535。')
    if args.init_only and not args.demo_init:
        parser.error('--init-only 必须与 --demo-init 一起使用。')
    sys.dont_write_bytecode = True
    application = create_app(args.root)
    owned = application.extensions['standalone_runtime']
    temporary = str(owned.checked('temp'))
    os.environ['TEMP'] = temporary
    os.environ['TMP'] = temporary
    import tempfile
    tempfile.tempdir = temporary
    if args.demo_init:
        names = {'finance_maker': 'finance_maker', 'finance_reviewer': 'finance_reviewer',
                 'cashier_maker': 'cashier_maker', 'cashier_reviewer': 'cashier_reviewer', 'admin': 'admin'}
        credentials = {name: {'password': secrets.token_urlsafe(18), 'role': role} for name, role in names.items()}
        destination = owned.checked('demo-credentials.json', missing=True)
        if destination.exists():
            parser.error('口令文件已存在，拒绝覆盖。')
        seed_demo_users(application, credentials)
        with destination.open('x', encoding='utf-8') as output:
            json.dump(credentials, output, ensure_ascii=False, indent=2)
        print('全新虚构人员已建立。口令仅保存在：' + str(destination))
    with application.app_context():
        from .compat import connect
        connection = connect()
        try:
            if not connection.execute('SELECT 1 FROM standalone_users LIMIT 1').fetchone():
                parser.error('请先显式运行 --demo-init 建立虚构演示账户。')
        finally:
            connection.close()
    if args.init_only:
        return 0
    from waitress import create_server
    from waitress.task import ThreadedTaskDispatcher

    dispatcher = ThreadedTaskDispatcher()
    dispatcher.set_thread_count(4)
    socket_map = {}
    server = None
    monitor = None
    stop_requested = threading.Event()
    dispatcher_stopped = threading.Event()
    shutdown_lock = threading.Lock()
    shutdown_errors = []

    def close_sockets():
        # These are only this create_server call's private sockets. Closing
        # keepalive channels after workers stop lets the event loop terminate.
        for channel in list(socket_map.values()):
            try:
                channel.close()
            except Exception as error:
                shutdown_errors.append(type(error).__name__)
        if server is not None:
            try:
                server.close()
            except Exception as error:
                shutdown_errors.append(type(error).__name__)

    def stop_dispatcher():
        with shutdown_lock:
            if dispatcher_stopped.is_set():
                return
            stop_requested.set()
            try:
                if server is not None:
                    server.accepting = False
                dispatcher.shutdown(cancel_pending=False, timeout=10)
                if dispatcher.threads:
                    shutdown_errors.append('worker-shutdown-timeout')
            except Exception as error:
                shutdown_errors.append(type(error).__name__)
            finally:
                dispatcher_stopped.set()

    def watch_parent():
        try:
            # No commands are accepted on this pipe; its lifetime is the only
            # signal. Only EOF from the owning desktop asks this child to stop.
            while sys.stdin.buffer.read(4096):
                pass
        except Exception as error:
            shutdown_errors.append('parent-pipe-' + type(error).__name__)
        finally:
            stop_dispatcher()
            try:
                server.trigger.pull_trigger(close_sockets)
            except Exception:
                close_sockets()

    status = 0
    try:
        server = create_server(application, map=socket_map, _dispatcher=dispatcher,
            host='127.0.0.1', port=args.port, threads=4, expose_tracebacks=False,
            asyncore_loop_timeout=0.25)
        # create_server has already bound/listened. Report only public process
        # identity, so a desktop never loads an unrelated service on that port.
        print(json.dumps({'type': 'ready', 'port': int(server.effective_port),
            'namespace': owned.namespace, 'pid': os.getpid()}, separators=(',', ':')), flush=True)
        if args.parent_watch:
            monitor = threading.Thread(target=watch_parent, name='standalone-parent-watch', daemon=True)
            monitor.start()
        else:
            print(f'仅本机开发服务：http://127.0.0.1:{server.effective_port}/ （Ctrl+C 正常停止）', file=sys.stderr, flush=True)
        server.run()
    except KeyboardInterrupt:
        stop_requested.set()
    except Exception as error:
        print('独立开发服务绑定或运行失败：' + type(error).__name__, file=sys.stderr, flush=True)
        status = 1
    finally:
        stop_dispatcher()
        close_sockets()
        if monitor is not None and monitor is not threading.current_thread():
            monitor.join(timeout=1)
        if shutdown_errors:
            print('独立开发服务关闭异常：' + ','.join(shutdown_errors), file=sys.stderr, flush=True)
            status = 3
    return status


if __name__ == '__main__':
    raise SystemExit(main())
