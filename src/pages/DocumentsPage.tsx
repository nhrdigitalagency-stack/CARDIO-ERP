import React, { useEffect, useState } from 'react';
import {
  Archive,
  Download,
  FileText,
  FileUp,
  Share2,
} from 'lucide-react';
import {
  EmptyState,
  Modal,
  StatusBadge,
  TableSkeleton,
} from '../components/UIPrimitives';
import type {
  DocumentCategory,
  MedicalDocument,
  Patient,
  PublicUser,
} from '../shared/types';
import { DOCUMENT_CATEGORY_LABELS } from '../shared/constants';
import { apiFetch, downloadProtectedFile, formatDateFr, hasPerm } from '../lib/api';
import { buildQuerySuffix, navigate, useAppRoute } from '../lib/router';
import { useLiveSync } from '../lib/useLiveSync';

export const DocumentsPage: React.FC<{
  user: PublicUser;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}> = ({ user, notify }) => {
  const route = useAppRoute();
  const isRoot = route.segments[0] === 'documents';
  const isUploadUrl = isRoot && route.segments[1] === 'importer';
  const queryPatientId = route.query.get('patientId') || '';
  const categoryFilter = route.query.get('categorie') || '';
  const patientFilter = !isUploadUrl ? queryPatientId : '';
  const search = route.query.get('q') || '';

  const [docs, setDocs] = useState<MedicalDocument[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);

  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    title: '',
    category: 'COMPTE_RENDU' as DocumentCategory,
    patientId: queryPatientId,
    sharedWithPatient: false,
    file: null as File | null,
  });

  const isDoctor = hasPerm(user, 'medical:write');

  const filterQuery = buildQuerySuffix({
    categorie: categoryFilter || undefined,
    patientId: patientFilter || undefined,
    q: search || undefined,
  });

  const setFilterParam = (key: 'categorie' | 'patientId' | 'q', val: string) => {
    navigate(
      `/documents${buildQuerySuffix({
        categorie: categoryFilter || undefined,
        patientId: patientFilter || undefined,
        q: search || undefined,
        [key]: val || undefined,
      })}`
    );
  };

  const closeModal = () => {
    navigate(`/documents${filterQuery}`);
  };

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (categoryFilter) qs.set('category', categoryFilter);
      if (patientFilter) qs.set('patientId', patientFilter);

      const [dRes, pRes] = await Promise.all([
        apiFetch<{ documents: MedicalDocument[] }>(`/api/documents?${qs.toString()}`),
        apiFetch<{ patients: Patient[] }>('/api/patients?status=ACTIF'),
      ]);
      setDocs(dRes.documents);
      setPatients(pRes.patients);
      if (pRes.patients[0] && !form.patientId) {
        setForm((f) => ({ ...f, patientId: pRes.patients[0]._id }));
      }
    } catch (err: any) {
      if (!silent) notify('error', err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [categoryFilter, patientFilter]);

  useLiveSync(['document', 'examination'], () => load(true));

  useEffect(() => {
    if (!isRoot) return;
    if (isUploadUrl) {
      if (!hasPerm(user, 'documents:write')) {
        navigate(`/documents${filterQuery}`, { replace: true });
        return;
      }
      if (queryPatientId) {
        setForm((f) => ({ ...f, patientId: queryPatientId }));
      }
    }
  }, [isRoot, isUploadUrl, queryPatientId]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.file) {
      notify('error', 'Veuillez sélectionner un fichier PDF ou image.');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', form.file);
      fd.append('title', form.title);
      fd.append('category', form.category);
      fd.append('patientId', form.patientId);
      fd.append('sharedWithPatient', String(form.sharedWithPatient));

      await apiFetch('/api/documents/upload', {
        method: 'POST',
        body: fd,
      });
      notify('success', 'Document enregistré de manière sécurisée dans Cloudflare R2.');
      setForm({ ...form, title: '', file: null, sharedWithPatient: false });
      closeModal();
      await load();
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setUploading(false);
    }
  };

  const toggleShare = async (doc: MedicalDocument) => {
    try {
      await apiFetch(`/api/documents/${doc._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ sharedWithPatient: !doc.sharedWithPatient }),
      });
      notify('success', doc.sharedWithPatient ? 'Partage patient retiré.' : 'Document partagé avec le patient.');
      await load();
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  const archiveDoc = async (doc: MedicalDocument) => {
    try {
      await apiFetch(`/api/documents/${doc._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: true }),
      });
      notify('success', 'Document archivé.');
      await load();
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  const filtered = docs.filter((d) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      d.title.toLowerCase().includes(q) ||
      (d.patientName || '').toLowerCase().includes(q) ||
      d.originalName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="search"
            value={search}
            onChange={(e) => setFilterParam('q', e.target.value)}
            placeholder="Rechercher document / patient..."
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F4F7FB] dark:bg-slate-900 text-xs"
          />
          <select
            value={categoryFilter}
            onChange={(e) => setFilterParam('categorie', e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
          >
            <option value="">Toutes catégories</option>
            {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={patientFilter}
            onChange={(e) => setFilterParam('patientId', e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
          >
            <option value="">Tous patients</option>
            {patients.map((p) => (
              <option key={p._id} value={p._id}>
                {p.patientNumber} — {p.firstName} {p.lastName}
              </option>
            ))}
          </select>
        </div>

        {hasPerm(user, 'documents:write') && (
          <button
            type="button"
            onClick={() => navigate(`/documents/importer${filterQuery}`)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white text-sm font-medium"
          >
            <FileUp className="w-4 h-4" />
            Importer un document
          </button>
        )}
      </div>

      {loading ? (
        <TableSkeleton rows={5} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Aucun document dans la bibliothèque"
          description="Importez des PDF ou images (ECG, Holter, échographies, courriers) dans le stockage privé sécurisé."
          actionLabel={hasPerm(user, 'documents:write') ? 'Importer un document' : undefined}
          onAction={hasPerm(user, 'documents:write') ? () => navigate(`/documents/importer${filterQuery}`) : undefined}
        />
      ) : (
        <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs text-[#708197] border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Document</th>
                  <th className="px-4 py-3 font-medium">Patient</th>
                  <th className="px-4 py-3 font-medium">Catégorie</th>
                  <th className="px-4 py-3 font-medium">Partage patient</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((d) => (
                  <tr key={d._id} className="hover:bg-[#EAF4FC]/30 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-semibold">
                        <FileText className="w-4 h-4 text-[#1265A3] shrink-0" />
                        <span>{d.title}</span>
                      </div>
                      <div className="text-[11px] font-mono text-[#708197] pl-6">
                        {d.originalName} · {Math.round(d.sizeBytes / 1024)} Ko
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs font-medium">{d.patientName}</td>
                    <td className="px-4 py-3 text-xs">{DOCUMENT_CATEGORY_LABELS[d.category]}</td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        label={d.sharedWithPatient ? 'Partagé' : 'Interne'}
                        tone={d.sharedWithPatient ? 'success' : 'neutral'}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-[#708197] tabular-nums">
                      {formatDateFr(d.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          downloadProtectedFile(`/api/documents/${d._id}/download`, d.originalName || d.title).catch((err: any) =>
                            notify('error', err.message || 'Téléchargement impossible.')
                          )
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <Download className="w-3.5 h-3.5" /> Télécharger
                      </button>
                      {isDoctor && (
                        <button
                          type="button"
                          onClick={() => toggleShare(d)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs"
                          title="Basculer partage patient"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {hasPerm(user, 'documents:write') && (
                        <button
                          type="button"
                          onClick={() => archiveDoc(d)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-[#708197] hover:text-[#D71920]"
                          title="Archiver"
                        >
                          <Archive className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={isUploadUrl} onClose={closeModal} title="Importer un document privé" maxWidth="max-w-md">
        <form onSubmit={handleUpload} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Titre du document *</label>
            <input
              type="text"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Patient *</label>
            <select
              required
              value={form.patientId}
              onChange={(e) => setForm({ ...form, patientId: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              {patients.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.patientNumber} — {p.firstName} {p.lastName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Catégorie *</label>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as DocumentCategory })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Fichier (PDF, PNG, JPEG, WEBP — max 15 Mo) *</label>
            <input
              type="file"
              required
              accept=".pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })}
              className="w-full text-xs file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-[#EAF4FC] file:text-[#073B70] file:font-medium"
            />
          </div>
          {isDoctor && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={form.sharedWithPatient}
                onChange={(e) => setForm({ ...form, sharedWithPatient: e.target.checked })}
              />
              Autoriser l'accès dans l'espace personnel du patient
            </label>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700">
              Annuler
            </button>
            <button type="submit" disabled={uploading} className="px-4 py-2 text-sm rounded-lg bg-[#073B70] text-white font-medium">
              {uploading ? 'Importation...' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
