# KPM Media Classification

> Historical product model.

## Objective

Classify media by its primary purpose:

- Knowledge: reusable reference or learning material.
- Projects: evidence, progress, campaign, design, or active work.
- Management: logistical, administrative, inventory, receipt, and support
  material.

One asset may link to multiple categories without duplicating the original.

## Ingestion

1. Store the original under a dated asset path.
2. Generate thumbnails and optional OCR.
3. Suggest tags through configured AI.
4. Ask the user when the category cannot be inferred safely.

Sensitive management media receives a clear private indicator and appropriate
access controls. Labels use i18n with English defaults.
