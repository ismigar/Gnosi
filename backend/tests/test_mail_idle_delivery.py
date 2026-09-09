"""Mail push clients must not reserve the workers used by local page reads."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import Thread

import pytest

from backend.domains.mail.routes.messages import mail_events
from backend.domains.mail.sync.idle import ImapIdleManager, _Subscriber
from backend.services import imap_idle_service


def test_idle_streams_leave_shared_worker_available_and_unsubscribe(monkeypatch):
    manager = ImapIdleManager()
    monkeypatch.setattr(imap_idle_service, "idle_manager", manager)

    async def scenario():
        loop = asyncio.get_running_loop()
        # Even one worker should remain available while several tabs listen.
        loop.set_default_executor(ThreadPoolExecutor(max_workers=1))
        responses = [await mail_events(None) for _ in range(4)]
        streams = [response.body_iterator for response in responses]
        for stream in streams:
            assert await anext(stream) == "event: ready\ndata: {}\n\n"
        pending = [asyncio.create_task(anext(stream)) for stream in streams]
        await asyncio.sleep(0)
        try:
            assert (
                await asyncio.wait_for(asyncio.to_thread(lambda: "local read"), 1) == "local read"
            )
            manager._broadcast({"account": "a@example.test", "type": "new_message"})
            results = await asyncio.wait_for(asyncio.gather(*pending), 1)
            assert all("event: new_message\n" in result for result in results)
        finally:
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            for stream in streams:
                await stream.aclose()
        assert manager._subscribers == []

    asyncio.run(scenario())


def test_push_from_idle_thread_wakes_listener_and_filters_accounts():
    async def scenario():
        subscriber = _Subscriber("a@example.test")
        subscriber.push({"account": "b@example.test", "type": "ignored"})
        waiting = asyncio.create_task(subscriber.pop(1))
        await asyncio.sleep(0)
        event = {"account": "a@example.test", "type": "flags_changed", "raw": "synthetic"}
        sender = Thread(target=subscriber.push, args=(event,))
        sender.start()
        try:
            delivered = await asyncio.wait_for(waiting, 1)
            assert delivered == event
            assert delivered is not event
            assert await subscriber.pop(0) is None
        finally:
            sender.join(1)
            assert not sender.is_alive()

    asyncio.run(scenario())


def test_queued_events_keep_order_and_bounded_backlog():
    async def scenario():
        subscriber = _Subscriber()
        for number in range(1030):
            subscriber.push({"number": number})
        assert [await subscriber.pop(0) for _ in range(1024)] == [
            {"number": number} for number in range(6, 1030)
        ]
        assert await subscriber.pop(0) is None

    asyncio.run(scenario())


@pytest.mark.parametrize("cancel_before_push", [True, False])
def test_cancelled_wait_does_not_lose_pending_event(cancel_before_push):
    async def scenario():
        subscriber = _Subscriber()
        waiting = asyncio.create_task(subscriber.pop(1))
        await asyncio.sleep(0)
        event = {"type": "new_message"}
        if cancel_before_push:
            waiting.cancel()
            subscriber.push(event)
        else:
            subscriber.push(event)
            waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
        assert await subscriber.pop(0) == event
        assert not subscriber._async_waiters

    asyncio.run(scenario())


def test_timeout_removes_waiter_and_next_event_is_delivered():
    async def scenario():
        subscriber = _Subscriber()
        assert await subscriber.pop(0.001) is None
        assert not subscriber._async_waiters
        subscriber.push({"type": "new_message"})
        assert await subscriber.pop(0) == {"type": "new_message"}

    asyncio.run(scenario())


def test_unsubscribe_wakes_waiting_client_and_discards_future_pushes():
    async def scenario():
        manager = ImapIdleManager()
        subscriber = manager.subscribe()
        waiting = asyncio.create_task(subscriber.pop(30))
        await asyncio.sleep(0)
        manager.unsubscribe(subscriber)
        assert await asyncio.wait_for(waiting, 1) is None
        subscriber.push({"type": "new_message"})
        assert await subscriber.pop(0) is None
        assert not subscriber.queue
        assert manager._subscribers == []

    asyncio.run(scenario())


def test_sync_subscriber_remains_compatible():
    subscriber = _Subscriber()
    subscriber.push({"type": "new_message"})
    assert subscriber.pop_blocking(0) == {"type": "new_message"}
    subscriber.close()
    assert subscriber.pop_blocking(30) is None
