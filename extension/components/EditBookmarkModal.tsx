import { useState, useRef } from 'react';
import { X } from 'lucide-react';
import type { Bookmark, Collection } from '@/lib/api';
import { descriptionForUpdate } from '@/lib/bookmarkDescription';
import FaviconField from './FaviconField';

interface EditBookmarkModalProps {
  bookmark: Bookmark;
  collections: Collection[];
  onSave: (updates: Partial<Bookmark>) => Promise<void>;
  onClose: () => void;
}

export default function EditBookmarkModal({ bookmark, collections, onSave, onClose }: EditBookmarkModalProps) {
  const mousedownOnBackdropRef = useRef(false);
  const [title, setTitle] = useState(bookmark.title);
  const [url, setUrl] = useState(bookmark.url);
  const [description, setDescription] = useState(bookmark.description ?? '');
  const [tags, setTags] = useState(bookmark.tags.join(', '));
  const [favicon, setFavicon] = useState(bookmark.favicon ?? '');
  const [collectionId, setCollectionId] = useState(bookmark.collectionId);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        title,
        url,
        description: descriptionForUpdate(description),
        tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        favicon,
        collectionId: collectionId !== bookmark.collectionId ? collectionId : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    mousedownOnBackdropRef.current = e.target === e.currentTarget;
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    if (!mousedownOnBackdropRef.current) return;
    mousedownOnBackdropRef.current = false;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--backdrop)]" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
      <form
        className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Edit Bookmark</h3>
          <button type="button" onClick={onClose} className="text-[var(--muted)] hover:text-[var(--foreground)]">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3">
          <Field label="Title" value={title} onChange={setTitle} />
          <Field label="URL" value={url} onChange={setUrl} type="url" />
          <Field label="Description" value={description} onChange={setDescription} />
          <Field label="Tags" value={tags} onChange={setTags} placeholder="comma separated" />
          <FaviconField value={favicon} onChange={setFavicon} pageUrl={url} title={title} />

          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--muted)]">Collection</label>
            <select
              className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
              value={collectionId}
              onChange={(e) => setCollectionId(e.target.value)}
            >
              {collections.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--background)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !title || !url}
            className="rounded bg-[var(--accent)] px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-[var(--muted)]">{label}</label>
      <input
        type={type}
        className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:ring-1 focus:ring-[var(--accent)]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
