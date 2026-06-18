from typing import Dict, Protocol


class ProviderDiscoveryPlugin(Protocol):
    id: str
    order: int

    def discover(self, context: Dict) -> Dict:
        ...
