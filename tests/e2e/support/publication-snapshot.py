"""Build browser fixtures with the real publication producer and synthetic notes."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from backend.domains.vault.publishing.markdown import SelectedNote, SnapshotMarkdown
from backend.domains.vault.publishing.schemas import PublicationBundle


first = r"""# Introduction

**Reviewed snapshot**

[[Second selected note#Details|Second note]]

![[never-selected]]

![private asset](/api/vault/assets/never-published.png)

| Topic | Status |
| --- | --- |
| Publication | Ready |

A separate table follows.

| Another | Table | Width |
| :--- | :---: | ---: |
| Rendering | Preserved | Three |
| `left\|right` | $x\|y$ | plain\|text |

1\. This is a literal paragraph.

\- This is another literal paragraph.

3. Third step
4. Fourth step

- [x] Complete
- [ ] Remaining

$\frac{a}{b}$

$$
x = \frac{a}{b}
$$

```text
Code keeps $\frac{a}{b}$ literal.
```
"""
second = (
    """## Details

A searchable phrase only in the second note.

[[First selected note|First note]]

```ts
const snapshot = true;
```

"""
    + "A retained paragraph from the selected note.\n\n" * 20
    + "End of the saved note."
)

bundle = PublicationBundle(
    title="Synthetic publication",
    published_at=1780000000,
    expires_at=None,
    revision=1,
    pages=SnapshotMarkdown(
        [
            SelectedNote("synthetic-page", "First selected note", "first.md", (), first),
            SelectedNote("synthetic-second", "Second selected note", "second.md", (), second),
        ]
    ).render(),
)
sys.stdout.write(bundle.model_dump_json())
