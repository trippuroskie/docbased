import { createServiceClient } from "@/lib/supabase/server";
import { env, CHAT_MODEL_ALLOWLIST } from "@/lib/env";

export type UserSettings = {
  chatModels: string[];
  defaultChatModel: string | null;
  embeddingModel: string | null;
  rerankerModel: string | null;
};

export const EMPTY_USER_SETTINGS: UserSettings = {
  chatModels: [],
  defaultChatModel: null,
  embeddingModel: null,
  rerankerModel: null,
};

/** Reads the user's row, returning empty defaults if no row exists yet. */
export async function getUserSettings(userId: string): Promise<UserSettings> {
  const admin = createServiceClient();
  const { data } = await admin
    .from("user_settings")
    .select(
      "chat_models, default_chat_model, embedding_model, reranker_model",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return EMPTY_USER_SETTINGS;
  return {
    chatModels: (data.chat_models as string[]) ?? [],
    defaultChatModel: (data.default_chat_model as string | null) ?? null,
    embeddingModel: (data.embedding_model as string | null) ?? null,
    rerankerModel: (data.reranker_model as string | null) ?? null,
  };
}

/**
 * Effective chat model picker list for a user: their saved selection if any,
 * otherwise the global env allowlist. Used to populate dropdowns and to
 * authorize incoming chat requests.
 */
export function effectiveChatModels(settings: UserSettings): string[] {
  if (settings.chatModels.length > 0) return settings.chatModels;
  return [...CHAT_MODEL_ALLOWLIST];
}

/**
 * Effective default chat model. Order:
 *   1. user's saved default (if it's still in their enabled list)
 *   2. first of their enabled list
 *   3. env.defaultChatModel
 */
export function effectiveDefaultChatModel(settings: UserSettings): string {
  const enabled = effectiveChatModels(settings);
  if (settings.defaultChatModel && enabled.includes(settings.defaultChatModel)) {
    return settings.defaultChatModel;
  }
  if (enabled.length > 0) return enabled[0];
  return env.defaultChatModel;
}

export function effectiveEmbeddingModel(settings: UserSettings): string {
  return settings.embeddingModel ?? env.embeddingModel;
}

export function effectiveRerankerModel(settings: UserSettings): string {
  return settings.rerankerModel ?? env.rerankerModel;
}
