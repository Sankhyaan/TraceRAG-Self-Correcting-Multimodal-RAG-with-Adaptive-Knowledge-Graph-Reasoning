-- ==============================================================================
-- Trace RAG Phase 8: Auth Schema Migration (Self-Contained)
-- Run this in Supabase Dashboard → SQL Editor
-- Safe to run multiple times (all statements are idempotent).
-- This script creates any missing tables before altering them.
-- ==============================================================================

-- ==============================================================================
-- STEP 1: Ensure all base tables exist (idempotent)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New Conversation',
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    storage_url TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    mime_type TEXT,
    extracted_text TEXT,
    status TEXT DEFAULT 'pending' NOT NULL,
    extraction_error TEXT,
    uploaded_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    citations JSONB DEFAULT '[]'::jsonb,
    critic_info JSONB,
    groundedness_score REAL,
    retry_info JSONB,
    graph_hops JSONB DEFAULT '[]'::jsonb,
    graph_entities JSONB DEFAULT '[]'::jsonb,
    graph_context_text TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ==============================================================================
-- STEP 2: Add any missing columns to existing tables
-- ==============================================================================

-- files table columns (Phase 1 optional migrations)
ALTER TABLE files ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE files ADD COLUMN IF NOT EXISTS extraction_error TEXT;

-- messages table columns (Phase 7 graph columns)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS retry_info JSONB;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS graph_hops JSONB DEFAULT '[]'::jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS graph_entities JSONB DEFAULT '[]'::jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS graph_context_text TEXT DEFAULT '';

-- ==============================================================================
-- STEP 3: Add user_id column to all tables (Phase 8 Auth)
-- ==============================================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE files
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- ==============================================================================
-- STEP 4: Performance Indexes
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_files_conversation_id ON files(conversation_id);
CREATE INDEX IF NOT EXISTS idx_files_file_type ON files(file_type);
CREATE INDEX IF NOT EXISTS idx_files_uploaded_at ON files(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at ASC);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);

-- ==============================================================================
-- STEP 5: Enable Row Level Security on all tables
-- ==============================================================================

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- ==============================================================================
-- STEP 6: RLS Policies — conversations
-- ==============================================================================

DROP POLICY IF EXISTS "conversations_select_own" ON conversations;
DROP POLICY IF EXISTS "conversations_insert_own" ON conversations;
DROP POLICY IF EXISTS "conversations_update_own" ON conversations;
DROP POLICY IF EXISTS "conversations_delete_own" ON conversations;

CREATE POLICY "conversations_select_own"
  ON conversations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "conversations_insert_own"
  ON conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "conversations_update_own"
  ON conversations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "conversations_delete_own"
  ON conversations FOR DELETE
  USING (auth.uid() = user_id);

-- ==============================================================================
-- STEP 7: RLS Policies — files
-- ==============================================================================

DROP POLICY IF EXISTS "files_select_own" ON files;
DROP POLICY IF EXISTS "files_insert_own" ON files;
DROP POLICY IF EXISTS "files_update_own" ON files;
DROP POLICY IF EXISTS "files_delete_own" ON files;

CREATE POLICY "files_select_own"
  ON files FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "files_insert_own"
  ON files FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "files_update_own"
  ON files FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "files_delete_own"
  ON files FOR DELETE
  USING (auth.uid() = user_id);

-- ==============================================================================
-- STEP 8: RLS Policies — messages
-- ==============================================================================

DROP POLICY IF EXISTS "messages_select_own" ON messages;
DROP POLICY IF EXISTS "messages_insert_own" ON messages;
DROP POLICY IF EXISTS "messages_delete_own" ON messages;

CREATE POLICY "messages_select_own"
  ON messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "messages_insert_own"
  ON messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "messages_delete_own"
  ON messages FOR DELETE
  USING (auth.uid() = user_id);

-- ==============================================================================
-- NOTES
-- ==============================================================================
-- • The backend uses SERVICE_ROLE_KEY which bypasses all RLS — it always works.
-- • RLS only restricts the Supabase anon client (frontend auth calls).
-- • Existing rows with user_id = NULL are not visible to logged-in users.
--   To reassign existing data to your user, find your UUID in:
--   Supabase Dashboard → Authentication → Users
--   Then run:
--     UPDATE conversations SET user_id = 'your-uuid' WHERE user_id IS NULL;
--     UPDATE files SET user_id = 'your-uuid' WHERE user_id IS NULL;
--     UPDATE messages SET user_id = 'your-uuid' WHERE user_id IS NULL;
