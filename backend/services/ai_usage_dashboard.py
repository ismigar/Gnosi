"""Filtered projections and CSV for the provider-independent usage ledger."""
from __future__ import annotations
import calendar
import csv
import io
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, Query
from backend.services.ai_usage_ledger import connect, decimal_cost

UsageGroup = Literal['provider', 'model', 'agent', 'operation', 'origin', 'profile']

@dataclass
class UsageQuery:
    start: date
    end: date
    timezone: str
    group_by: UsageGroup = 'model'
    provider: str = ''
    model: str = ''
    agent: str = ''
    operation: str = ''
    origin: str = ''
    profile: str = ''
    granularity: str = 'day'


def usage_query(start: date | None = None, end: date | None = None,
                timezone: str = 'UTC', group_by: UsageGroup = 'model',
                provider: str = '', model: str = '', agent: str = '',
                operation: str = '', origin: str = '', profile: str = '',
                granularity: Literal['day', 'month'] = 'day') -> UsageQuery:
    try:
        zone = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, 'Invalid timezone') from None
    today = datetime.now(zone).date()
    start, end = start or today - timedelta(days=6), end or today
    if end < start or (end - start).days > 36525:
        raise HTTPException(422, 'Invalid date interval')
    return UsageQuery(start, end, timezone, group_by, provider, model, agent, operation, origin, profile, granularity)


def _dimension(row: dict[str, Any], dimension: str) -> tuple[str, str]:
    if dimension == 'model':
        key = f"{row['provider']}:{row['model_id']}"
        return key, f"{row['model_id']} · {row['provider']}"
    if dimension == 'agent':
        return row['agent_id'], row['agent_name'] or row['agent_id']
    key = str(row[dimension] or 'unattributed')
    return key, key


def records(query: UsageQuery, scope: Any, *, filtered: bool = True) -> tuple[list[dict[str, Any]], bool]:
    from backend.config.app_config import load_params
    personal = load_params(strict_env=False).gnosi_mode == 'personal'
    zone = ZoneInfo(query.timezone)
    start = datetime.combine(query.start, time.min, zone).timestamp()
    end = datetime.combine(query.end + timedelta(days=1), time.min, zone).timestamp()
    with connect() as db:
        condition = 'created>=? AND created<? AND workspace_id=?'
        params: list[Any] = [start, end, scope.workspace_id]
        if personal:
            condition = 'created>=? AND created<? AND (workspace_id=? OR workspace_id=\'\')'
        if scope.role not in {'admin', 'owner'}:
            condition += ' AND user_id=?'
            params.append(scope.user_id)
        rows = [dict(row) for row in db.execute('SELECT * FROM usage_calls WHERE ' + condition + ' ORDER BY created DESC,id DESC', params)]
        legacy = [dict(row) for row in db.execute('SELECT * FROM usage_legacy')] if personal and scope.role in {'admin', 'owner'} else []
    excluded = False
    for row in legacy:
        try:
            first = date.fromisoformat(row['period'] + '-01')
            last = first.replace(day=calendar.monthrange(first.year, first.month)[1])
        except ValueError:
            continue
        if last < query.start or first > query.end:
            continue
        if first < query.start or last > query.end:
            excluded = True
            continue
        rows.append({**row, 'id': 'legacy:' + row['period'] + ':' + row['provider'] + ':' + row['model_id'],
            'created': None, 'agent_id': 'unattributed', 'agent_name': '', 'operation': 'unattributed',
            'origin': 'legacy', 'profile': 'unrated', 'duration_ms': 0, 'status': 'legacy',
            'cost_source': 'legacy', 'cached_tokens': None, 'reasoning_tokens': None, 'run_id': ''})
    if filtered:
        rows = [row for row in rows if all(not getattr(query, dimension) or _dimension(row, dimension)[0] == getattr(query, dimension) for dimension in ('provider','model','agent','operation','origin','profile'))]
    return rows, excluded


def currency_context() -> dict[str, Any]:
    from backend.config.app_config import load_params
    from backend.services.fx_rates import parse_currency_code, rate_info
    cfg = load_params(strict_env=False)
    return dict(rate_info(parse_currency_code((cfg.get('settings', {}) or {}).get('currency'))))


def summary(rows: list[dict[str, Any]], currency: dict[str, Any]) -> dict[str, Any]:
    known = [decimal_cost(row['cost_usd']) for row in rows if row['cost_usd'] is not None]
    total = sum((value for value in known if value is not None), Decimal(0)) if known or not rows else None
    return {'calls': sum(row['status'] != 'legacy' for row in rows),
            'input_tokens': sum(row['input_tokens'] or 0 for row in rows),
            'output_tokens': sum(row['output_tokens'] or 0 for row in rows),
            'cached_tokens': sum(row['cached_tokens'] or 0 for row in rows),
            'reasoning_tokens': sum(row['reasoning_tokens'] or 0 for row in rows),
            'cost_usd': float(total) if total is not None else None,
            'cost_ccy': float(total * Decimal(str(currency['usd_rate']))) if total is not None else None,
            'unknown_cost_calls': sum(row['cost_usd'] is None for row in rows),
            'unknown_usage_calls': sum(row['input_tokens'] is None or row['output_tokens'] is None for row in rows),
            'estimated_calls': sum(row['cost_source'] == 'estimated' for row in rows),
            'failed_calls': sum(row['status'] in {'failed','cancelled'} for row in rows),
            'legacy_records': sum(row['status'] == 'legacy' for row in rows)}


def dashboard(query: UsageQuery, scope: Any) -> dict[str, Any]:
    from backend.agent.model_router import budget_status
    currency = currency_context()
    today = datetime.now(ZoneInfo(query.timezone)).date()
    monthly_rows, _ = records(UsageQuery(today.replace(day=1), today.replace(day=calendar.monthrange(today.year, today.month)[1]), query.timezone), scope)
    rows, excluded = records(query, scope)
    all_rows, _ = records(query, scope, filtered=False)
    groups: dict[str, list[dict[str, Any]]] = {}
    labels: dict[str, str] = {}
    for row in rows:
        key, label = _dimension(row, query.group_by)
        labels[key] = label
        groups.setdefault(key, []).append(row)
    breakdown = [{'key': key, 'label': labels[key], **summary(group, currency)} for key, group in groups.items()]
    breakdown.sort(key=lambda r: (-(r['cost_usd'] or 0), -r['calls'], r['key']))
    granularity = 'month' if query.granularity == 'month' or any(r['status'] == 'legacy' for r in rows) else 'day'
    zone = ZoneInfo(query.timezone)
    bins: dict[str, dict[str, list[dict[str, Any]]]] = {}
    day = query.start
    if granularity == 'month' and rows:
        oldest = min(date.fromisoformat(row['period'] + '-01') for row in rows)
        day = max(day, oldest)
    while day <= query.end:
        key = day.strftime('%Y-%m' if granularity == 'month' else '%Y-%m-%d')
        bins.setdefault(key, {})
        if granularity == 'month':
            day = (day.replace(day=28) + timedelta(days=4)).replace(day=1)
        else:
            day += timedelta(days=1)
    for row in rows:
        stamp = row['period'] if row['created'] is None else datetime.fromtimestamp(row['created'], zone).strftime('%Y-%m' if granularity == 'month' else '%Y-%m-%d')
        key, _ = _dimension(row, query.group_by)
        bins.setdefault(stamp, {}).setdefault(key, []).append(row)
    series = [{'date': stamp, 'groups': [{'key': key, 'label': labels[key], **summary(values, currency)} for key, values in group.items()], **summary([r for values in group.values() for r in values], currency)} for stamp, group in sorted(bins.items())]
    options = {dimension: [{'value': key, 'label': label} for key, label in sorted({_dimension(row, dimension) for row in all_rows})] for dimension in ('provider','model','agent','operation','origin','profile')}
    return {'currency': currency, 'start': query.start.isoformat(), 'end': query.end.isoformat(),
            'timezone': query.timezone, 'granularity': granularity,
            'summary': summary(rows, currency), 'groups': breakdown, 'series': series,
            'options': options, 'legacy_excluded': excluded, 'budget': budget_status(), 'budget_summary': summary(monthly_rows, currency)}


def requests(query: UsageQuery, scope: Any, page: int = 1, page_size: int = 25) -> dict[str, Any]:
    currency = currency_context()
    rows, _ = records(query, scope)
    rows = [row for row in rows if row['status'] != 'legacy']
    selected = rows[(page-1)*page_size:page*page_size]
    return {'total': len(rows), 'page': page, 'page_size': page_size,
            'currency': currency, 'items': [public_row(row, currency) for row in selected]}


def public_row(row: dict[str, Any], currency: dict[str, Any]) -> dict[str, Any]:
    cost = decimal_cost(row['cost_usd'])
    keys = ('id','period','provider','model_id','agent_id','agent_name','operation','origin','profile','input_tokens','output_tokens','cached_tokens','reasoning_tokens','duration_ms','status','cost_source')
    return {**{key: row[key] for key in keys}, 'created_at': datetime.fromtimestamp(row['created'], ZoneInfo('UTC')).isoformat() if row['created'] is not None else None,
            'cost_usd': float(cost) if cost is not None else None,
            'cost_ccy': float(cost * Decimal(str(currency['usd_rate']))) if cost is not None else None}


def export_csv(query: UsageQuery, scope: Any) -> str:
    currency = currency_context()
    rows, _ = records(query, scope)
    output = io.StringIO(newline='')
    fields = ['record_type','created_at','period','provider','model_id','agent_id','agent_name','operation','origin','input_tokens','output_tokens','cached_tokens','reasoning_tokens','cost_usd','cost_ccy','currency','cost_source','status','duration_ms']
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction='ignore')
    writer.writeheader()
    for row in rows:
        values = {**public_row(row, currency), 'currency': currency['code'], 'record_type': 'monthly_legacy' if row['status'] == 'legacy' else 'call'}
        # Category labels are user-controlled; export them as spreadsheet text.
        for key, value in values.items():
            if isinstance(value, str) and value.startswith(('=', '+', '-', '@', '\t', '\r')):
                values[key] = "'" + value
        writer.writerow(values)
    return '\ufeff' + output.getvalue()
