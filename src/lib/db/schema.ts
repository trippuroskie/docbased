import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  isAdmin: boolean("is_admin").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const spaces = pgTable("spaces", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const spaceAccess = pgTable(
  "space_access",
  {
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().$type<"viewer" | "editor" | "owner">(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.userId] })],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    path: text("path").notNull(),
    sourceFormat: text("source_format").notNull(),
    processingStatus: text("processing_status")
      .notNull()
      .default("indexed")
      .$type<"indexed" | "metadata_only" | "failed" | "pending">(),
    originalFilename: text("original_filename").notNull(),
    originalStoragePath: text("original_storage_path"),
    rawContent: text("raw_content"),
    contentHash: text("content_hash"),
    frontmatter: jsonb("frontmatter").default(sql`'{}'::jsonb`),
    tags: text("tags").array().default(sql`'{}'::text[]`),
    embeddingModel: text("embedding_model"),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    lastEditedBy: uuid("last_edited_by").references(() => users.id),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    lastEditedAt: timestamp("last_edited_at", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("documents_space_path_unique").on(t.spaceId, t.path),
    index("documents_status_idx").on(t.processingStatus),
  ],
);

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count"),
    headingPath: text("heading_path").array(),
    embedding: vector("embedding", { dimensions: 1536 }),
    embeddingModel: text("embedding_model")
      .notNull()
      .default("openai/text-embedding-3-small"),
  },
  (t) => [index("chunks_document_idx").on(t.documentId)],
);

export const links = pgTable(
  "links",
  {
    srcDocumentId: uuid("src_document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    dstTitle: text("dst_title").notNull(),
    dstDocumentId: uuid("dst_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
  },
  (t) => [primaryKey({ columns: [t.srcDocumentId, t.dstTitle] })],
);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  spaceIds: uuid("space_ids").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: uuid("conversation_id").references(() => conversations.id, {
    onDelete: "cascade",
  }),
  role: text("role").notNull().$type<"user" | "assistant" | "system">(),
  content: text("content").notNull(),
  model: text("model"),
  citations: jsonb("citations").default(sql`'[]'::jsonb`),
  feedback: text("feedback").$type<"up" | "down" | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("audit_log_actor_idx").on(t.actorId, t.createdAt),
    index("audit_log_target_idx").on(t.targetType, t.targetId),
  ],
);

export const chatUsage = pgTable(
  "chat_usage",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;
export type Space = typeof spaces.$inferSelect;
export type User = typeof users.$inferSelect;
export type Role = "viewer" | "editor" | "owner";
