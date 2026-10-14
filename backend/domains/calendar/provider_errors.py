"""Provider failures that remain distinguishable from empty calendars."""


class CalendarProviderError(Exception):
    """Safe API error, including uncertainty after an attempted remote write."""

    def __init__(self, status_code: int, detail: str, *, outcome_unknown: bool = False) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.outcome_unknown = outcome_unknown
