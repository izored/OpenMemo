"""SSRF guard on proxy URL validation (plans/003).

validate_proxy_url must reject loopback / private / link-local targets whether
they arrive as IP literals or as hostnames that resolve to such addresses.
"""
import pytest
from fastapi import HTTPException

from backend.core.security import validate_proxy_url


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/x.png",
    "http://localhost/x.png",
    "http://0.0.0.0/x.png",
    "http://10.0.0.8/x.png",
    "http://192.168.1.10/x.png",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/x.png",
])
def test_blocked_ip_literals(url):
    with pytest.raises(HTTPException) as exc:
        validate_proxy_url(url)
    assert exc.value.status_code == 400


def test_hostname_resolving_to_loopback_blocked(monkeypatch):
    import backend.core.security.sanitize as sanitize

    def fake_getaddrinfo(host, port, *args, **kwargs):
        return [(2, 1, 6, "", ("127.0.0.1", 0))]

    monkeypatch.setattr(sanitize._socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(HTTPException) as exc:
        validate_proxy_url("http://rebind.example.com/x.png")
    assert exc.value.status_code == 400


def test_hostname_resolving_to_public_allowed(monkeypatch):
    import backend.core.security.sanitize as sanitize

    def fake_getaddrinfo(host, port, *args, **kwargs):
        return [(2, 1, 6, "", ("93.184.216.34", 0))]

    monkeypatch.setattr(sanitize._socket, "getaddrinfo", fake_getaddrinfo)
    assert validate_proxy_url("https://example.com/x.png") == "https://example.com/x.png"


def test_unresolvable_hostname_blocked(monkeypatch):
    import socket

    import backend.core.security.sanitize as sanitize

    def fake_getaddrinfo(host, port, *args, **kwargs):
        raise socket.gaierror("no such host")

    monkeypatch.setattr(sanitize._socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(HTTPException) as exc:
        validate_proxy_url("https://no-such-host.invalid/x.png")
    assert exc.value.status_code == 400
