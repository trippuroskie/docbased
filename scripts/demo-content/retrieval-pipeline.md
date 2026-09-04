---
title: Retrieval Pipeline
tags: [architecture, search, rag]
---

# Retrieval Pipeline

Retrieval is hybrid: dense vectors catch paraphrase, lexical search catches
exact identifiers. Neither alone is sufficient — vector search misses error
codes and product SKUs, lexical search misses "how do I get time off".

## Stages

1. **Embed the query.** 1536-dim vector, same model that embedded the corpus.
2. **Two independent retrievals.** pgvector cosine similarity, and Postgres
   full-text search over a generated `tsvector` column.
3. **Fuse with Reciprocal Rank Fusion.** RRF needs no score calibration between
   the two systems, which is the whole reason to use it.
4. **Rerank (optional).** A cross-encoder rescores the top 40. Best-effort — a
   reranker timeout falls back to RRF order rather than failing the query.

## Why RRF and not weighted scores

Cosine distance and `ts_rank` are not on comparable scales, and the mapping
between them shifts with corpus size. RRF only reads *rank*, so it is stable:

$$\text{score}(d) = \sum_{r \in R} \frac{1}{k + \text{rank}_r(d)}$$

with `k = 60`. Documents ranked well by either retriever surface; documents
ranked well by both surface first.

## Chunking

Chunks target 1200 characters with 200 of overlap, split on heading and
paragraph boundaries. Large code blocks are stored but not embedded — they
pollute the vector space without improving recall.
