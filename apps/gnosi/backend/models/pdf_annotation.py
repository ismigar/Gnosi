"""Anotacions persistents per a PDFs oberts al visor del Vault.

Cada anotació es vincula al PDF per la seva URI canonical (file:// o
/api/vault/local-file/{token}). Si l'usuari mou el fitxer físicament, perd
les anotacions — és una limitació acceptada pel MVP. Una versió futura
podria afegir hashing SHA-256 per ancorar al contingut, no a la ruta.

Les coordenades dels rectangles estan **normalitzades** (0-1 respecte les
dimensions del viewport del PDF) perquè es mantinguin estables davant
canvis de zoom. Es serialitzen com a JSON al camp `rects_json` per evitar
una taula filla amb 1 row per rect.
"""

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Integer, String, Text

from backend.data.db import Base


class PdfAnnotation(Base):
    __tablename__ = "pdf_annotations"

    id = Column(Integer, primary_key=True, index=True)
    # URI canonical del PDF (file://… o /api/vault/local-file/{token}).
    # Indexat perquè la consulta més freqüent és "tots els highlights
    # d'aquest PDF concret".
    source_uri = Column(String, index=True, nullable=False)
    # Número de pàgina 1-indexed.
    page = Column(Integer, nullable=False)
    # Tipus d'anotació. Valors esperats: 'highlight', 'underline',
    # 'strikeout', 'comment' (note ancorada a un punt), 'area' (rectangle
    # dibuixat sobre la pàgina, p.ex. per ressaltar una imatge).
    type = Column(String, nullable=False)
    # Color hex incloent '#'. Per defecte groc Zotero-style.
    color = Column(String, default="#ffeb3b")
    # Llista de rectangles JSON-serialitzada. Format:
    #   [{"x": 0.1, "y": 0.2, "w": 0.5, "h": 0.03}, ...]
    # En coordenades normalitzades 0-1 respecte la pàgina del PDF.
    rects_json = Column(Text, nullable=True)
    # Text seleccionat (per a highlights/underline/strikeout).
    text = Column(Text, nullable=True)
    # Comentari escrit per l'usuari.
    comment = Column(Text, nullable=True)
    # Tags lliures separades per coma. Per a una versió futura amb
    # filtres a la sidebar.
    tags = Column(String, nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
