from __future__ import annotations

import select
import socket
import socketserver
import threading
from contextlib import AbstractContextManager
from ipaddress import IPv6Address


class _ForwardingServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class LinkLocalHttpBridge(AbstractContextManager):
    """Expose an IPv6 link-local web panel on loopback for Chromium."""

    def __init__(self, host: IPv6Address, adapter_index: int, remote_port: int = 80):
        self.host = str(host).split("%", 1)[0]
        self.adapter_index = int(adapter_index)
        self.remote_port = int(remote_port)
        bridge = self

        class Handler(socketserver.BaseRequestHandler):
            def handle(self) -> None:
                upstream = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
                try:
                    upstream.settimeout(5)
                    upstream.connect((bridge.host, bridge.remote_port, 0, bridge.adapter_index))
                    self.request.setblocking(False)
                    upstream.setblocking(False)
                    sockets = [self.request, upstream]
                    while True:
                        ready, _, _ = select.select(sockets, [], [], 8)
                        if not ready:
                            break
                        for source in ready:
                            try:
                                data = source.recv(65_536)
                            except BlockingIOError:
                                continue
                            if not data:
                                return
                            target = upstream if source is self.request else self.request
                            target.sendall(data)
                finally:
                    upstream.close()

        self.server = _ForwardingServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, name="zte-link-local-http", daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def __enter__(self) -> "LinkLocalHttpBridge":
        self.thread.start()
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

