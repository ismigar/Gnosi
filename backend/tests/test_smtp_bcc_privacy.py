"""Blind recipients belong to the SMTP envelope, never transmitted headers."""

from email import policy
from email.message import Message
from email.parser import BytesParser
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from backend.domains.mail.sync import smtp
from backend.services.integration_manager import integration_manager


@pytest.fixture
def transport(monkeypatch):
    import smtplib

    server = SimpleNamespace(
        sock=Mock(), ehlo=Mock(), starttls=Mock(), login=Mock(),
        sendmail=Mock(return_value={}), quit=Mock(), close=Mock(),
    )
    monkeypatch.setattr(smtplib, "SMTP", lambda *args, **kwargs: server)
    monkeypatch.setattr(smtplib, "SMTP_SSL", lambda *args, **kwargs: server)
    monkeypatch.setattr(integration_manager, "resolve_imap_defaults", lambda account: account)
    return server


@pytest.mark.parametrize("encryption", ["plain", "starttls", "ssl"])
@pytest.mark.parametrize("oauth", [False, True])
def test_blind_recipients_receive_mail_without_disclosure_in_mime(
    monkeypatch, transport, encryption, oauth,
):
    from backend.services import oauth2_helpers

    monkeypatch.setattr(integration_manager, "is_imap_oauth_account", lambda account: oauth)
    token = Mock(return_value="synthetic-access-token")
    authenticate = Mock()
    monkeypatch.setattr(smtp, "_smtp_oauth_token", token)
    monkeypatch.setattr(oauth2_helpers, "xoauth2_smtp_login", authenticate)
    attachment = b"Synthetic attachment\x00\xff"
    inline = b"Synthetic inline image\x00\xff"

    assert smtp.imap_smtp_send(
        {"email": "sender@example.test", "smtp_host": "synthetic.invalid",
         "smtp_port": 465 if encryption == "ssl" else 25,
         "smtp_encryption": encryption, "smtp_password": "synthetic-password"},
        "visible@example.test", "Synthetic private delivery",
        '<p>Visible body</p><img src="cid:synthetic-image">',
        cc="copy@example.test", bcc="blind@example.test",
        attachments=[{"filename": "synthetic.bin", "data": attachment}],
        inline_images=[{"filename": "synthetic.png", "content_type": "image/png",
                        "data": inline, "content_id": "synthetic-image"}],
    )

    transport.sendmail.assert_called_once()
    sender, recipients, wire = transport.sendmail.call_args.args
    assert sender == "sender@example.test"
    assert recipients == ["visible@example.test", "copy@example.test", "blind@example.test"]
    message = BytesParser(policy=policy.default).parsebytes(wire)
    assert message.get_all("Bcc") is None
    assert message.get_all("Resent-Bcc") is None
    assert b"blind@example.test" not in wire
    assert message["To"] == "visible@example.test"
    assert message["Cc"] == "copy@example.test"
    assert message["Subject"] == "Synthetic private delivery"
    assert "Visible body" in message.get_body(preferencelist=("html",)).get_content()
    parts = {part.get_filename(): part for part in message.walk() if part.get_filename()}
    assert parts["synthetic.bin"].get_payload(decode=True) == attachment
    assert parts["synthetic.png"].get_payload(decode=True) == inline
    assert parts["synthetic.png"]["Content-ID"] == "<synthetic-image>"
    if oauth:
        token.assert_called_once_with("sender@example.test")
        authenticate.assert_called_once_with(transport, "sender@example.test", "synthetic-access-token")
        transport.login.assert_not_called()
    else:
        token.assert_not_called()
        transport.login.assert_called_once_with("sender@example.test", "synthetic-password")
    transport.close.assert_called_once()


def test_wire_removes_all_blind_headers_without_mutating_local_message(transport):
    message = Message()
    message["From"] = "sender@example.test"
    message["To"] = "visible@example.test"
    message["bCc"] = "blind@example.test"
    message["Bcc"] = "other-blind@example.test"
    message["Resent-Bcc"] = "resent-blind@example.test"
    message.set_payload("Synthetic body\n")
    headers = list(message.raw_items())
    recipients = ["visible@example.test", "blind@example.test", "other-blind@example.test",
                  "resent-blind@example.test"]

    assert smtp._deliver_smtp(
        "synthetic.invalid", 25, "plain", lambda server: None,
        "sender@example.test", recipients, message,
    )

    sender, envelope, wire = transport.sendmail.call_args.args
    assert sender == "sender@example.test" and envelope == recipients
    received = BytesParser(policy=policy.default).parsebytes(wire)
    assert received.get_all("Bcc") is None
    assert received.get_all("Resent-Bcc") is None
    assert received.get_content() == "Synthetic body\n"
    assert list(message.raw_items()) == headers
