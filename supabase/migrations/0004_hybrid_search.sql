-- Hybrid retrieval: pgvector cosine + Postgres FTS fused via Reciprocal Rank Fusion.
-- security invoker means the function runs as the caller, so RLS still applies — defense in depth.

create or replace function hybrid_search(
  query_text       text,
  query_embedding  vector(1536),
  space_ids        uuid[],
  match_count      int default 20,
  rrf_k            int default 60
)
returns table (
  chunk_id     uuid,
  document_id  uuid,
  content      text,
  heading_path text[],
  score        float
)
language sql stable security invoker
as $$
  with accessible_chunks as (
    select c.id, c.document_id, c.content, c.heading_path, c.embedding, c.fts
    from chunks c
    join documents d on d.id = c.document_id
    where d.space_id = any(space_ids)
      and d.deleted_at is null
  ),
  vec as (
    select id as chunk_id, document_id, content, heading_path,
           row_number() over (order by embedding <=> query_embedding) as rank
    from accessible_chunks
    where embedding is not null
    order by embedding <=> query_embedding
    limit match_count * 2
  ),
  fts as (
    select id as chunk_id, document_id, content, heading_path,
           row_number() over (
             order by ts_rank_cd(fts, websearch_to_tsquery('english', query_text)) desc
           ) as rank
    from accessible_chunks
    where fts @@ websearch_to_tsquery('english', query_text)
    order by ts_rank_cd(fts, websearch_to_tsquery('english', query_text)) desc
    limit match_count * 2
  )
  select
    coalesce(vec.chunk_id, fts.chunk_id) as chunk_id,
    coalesce(vec.document_id, fts.document_id) as document_id,
    coalesce(vec.content, fts.content) as content,
    coalesce(vec.heading_path, fts.heading_path) as heading_path,
    coalesce(1.0/(rrf_k + vec.rank), 0) + coalesce(1.0/(rrf_k + fts.rank), 0) as score
  from vec
  full outer join fts on vec.chunk_id = fts.chunk_id
  order by score desc
  limit match_count;
$$;
