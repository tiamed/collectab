import { useState, useRef } from 'react';
import { X } from 'lucide-react';
import FaviconField from './FaviconField';

interface AddBookmarkModalProps {
  collectionId: string;
  onSave: (params: {
    collectionId: string;
    title: string;
    url: string;
    description?: string;
    favicon?: string;
    tags?: string[];
  }) => Promise<void>;
  onClose: () => void;
}

export default function AddBookmarkModal({ collectionId, onSave, onClose }: AddBookmarkModalProps) {
  const mousedownOnBackdropRef = useRef(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [favicon, setFavicon] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !url.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        collectionId,
        title: title.trim(),
        url: url.trim(),
        description: description.trim() || undefined,
        favicon: favicon.trim() || undefined,
        tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to save bookmark');
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
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Add Bookmark</h3>
          <button type="button" onClick={onClose} className="text-[var(--muted)] hover:text-[var(--foreground)]">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3">
          <Field label="URL" value={url} onChange={setUrl} type="url" placeholder="https://..." autoFocus />
          <Field label="Title" value={title} onChange={setTitle} placeholder="Page title" />
          <Field label="Description" value={description} onChange={setDescription} placeholder="Optional" />
          <Field label="Tags" value={tags} onChange={setTags} placeholder="comma separated" />
          <FaviconField value={favicon} onChange={setFavicon} pageUrl={url} title={title} />
        </div>

        {error && (
          <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2">
            <p className="text-[11px] text-red-400">{error}</p>
          </div>
        )}

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
            disabled={saving || !title.trim() || !url.trim()}
            className="rounded bg-[var(--accent)] px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Adding...' : 'Add'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder, autoFocus }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoFocus?: boolean;
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
        autoFocus={autoFocus}
      />
    </div>
  );
}
