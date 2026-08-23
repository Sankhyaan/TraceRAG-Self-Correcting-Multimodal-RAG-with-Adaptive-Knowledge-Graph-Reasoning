-- ==============================================================================
-- Trace RAG Database Schema: Conversations & Files Tables
-- Execute this script in your Supabase Dashboard -> SQL Editor
-- ==============================================================================

-- 1. Conversations Table
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New Conversation',
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 2. Files Table
CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,          -- 'document', 'image', 'audio', 'video'
    storage_path TEXT NOT NULL,       -- Path inside Supabase bucket: {conversation_id}/{file_id}{ext}
    storage_url TEXT NOT NULL,        -- Storage reference or signed URL
    file_size_bytes BIGINT NOT NULL,
    mime_type TEXT,
    extracted_text TEXT,              -- Plain text / transcription / OCR output (Phase 2)
    status TEXT DEFAULT 'pending' NOT NULL, -- 'pending', 'processing', 'done', 'failed'
    extraction_error TEXT,            -- Error details if extraction failed
    uploaded_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 3. Messages Table (Phase 6: Persistence & History)
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,               -- 'user' or 'assistant'
    content TEXT NOT NULL,
    citations JSONB DEFAULT '[]'::jsonb,
    critic_info JSONB,
    groundedness_score REAL,
    retry_info JSONB,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Optional migrations:
ALTER TABLE files ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE files ADD COLUMN IF NOT EXISTS extraction_error TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS retry_info JSONB;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_files_conversation_id ON files(conversation_id);
CREATE INDEX IF NOT EXISTS idx_files_file_type ON files(file_type);
CREATE INDEX IF NOT EXISTS idx_files_uploaded_at ON files(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at ASC);
