import React, { useEffect, useState } from 'react';
import { CreditCard, Download, Plus, Settings2 } from 'lucide-react';
import {
  EmptyState,
  Modal,
  StatCard,
  StatusBadge,
  TableSkeleton,
} from '../components/UIPrimitives';
import type {
  MedicalService,
  Patient,
  Payment,
  PaymentMethod,
  PublicUser,
} from '../shared/types';
import { apiFetch, formatDateFr, formatFcfa, hasPerm } from '../lib/api';
import { downloadFinancialReportPdf, downloadPaymentReceiptPdf } from '../lib/pdfGenerator';
import { buildQuerySuffix, navigate, useAppRoute } from '../lib/router';
import { useLiveSync } from '../lib/useLiveSync';

export const FinancePage: React.FC<{
  user: PublicUser;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}> = ({ user, notify }) => {
  const route = useAppRoute();
  const isRoot = route.segments[0] === 'finances';
  const seg1 = route.segments[1] || '';
  const seg2 = route.segments[2] || '';
  const seg3 = route.segments[3] || '';

  const tab: 'payments' | 'services' = seg1 === 'prestations' ? 'services' : 'payments';
  const isNewPaymentUrl = isRoot && seg1 === 'nouveau-paiement';
  const urlPaymentId = isRoot && seg1 === 'paiements' && seg2 && seg3 === 'complement' ? seg2 : null;
  const queryPatientId = route.query.get('patientId') || '';
  const startDate = route.query.get('debut') || '';
  const endDate = route.query.get('fin') || '';

  const [services, setServices] = useState<MedicalService[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);
  const [payForm, setPayForm] = useState({
    patientId: queryPatientId,
    serviceId: '',
    serviceName: '',
    totalAmountFcfa: '',
    amountPaidFcfa: '',
    method: 'ESPECES' as PaymentMethod,
    date: new Date().toISOString().slice(0, 10),
    notes: '',
  });

  const [installmentTarget, setInstallmentTarget] = useState<Payment | null>(null);
  const [installmentAmount, setInstallmentAmount] = useState('');

  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});

  const isAdmin = hasPerm(user, 'services:manage');
  const canPay = hasPerm(user, 'payments:write');

  const dateQuery = buildQuerySuffix({
    debut: startDate || undefined,
    fin: endDate || undefined,
  });

  const setTab = (next: 'payments' | 'services') => {
    if (next === 'services') navigate('/finances/prestations');
    else navigate(`/finances/paiements${dateQuery}`);
  };

  const setDateRange = (nextStart: string, nextEnd: string) => {
    navigate(
      `/finances/paiements${buildQuerySuffix({
        debut: nextStart || undefined,
        fin: nextEnd || undefined,
      })}`
    );
  };

  const closeModal = () => {
    navigate(`/finances/paiements${dateQuery}`);
  };

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (startDate) qs.set('startDate', startDate);
      if (endDate) qs.set('endDate', endDate);

      const [srvRes, payRes, patRes] = await Promise.all([
        apiFetch<{ services: MedicalService[] }>('/api/services'),
        hasPerm(user, 'payments:read')
          ? apiFetch<{ payments: Payment[] }>(`/api/payments?${qs.toString()}`)
          : Promise.resolve({ payments: [] }),
        hasPerm(user, 'patients:read_admin')
          ? apiFetch<{ patients: Patient[] }>('/api/patients?status=ACTIF')
          : Promise.resolve({ patients: [] }),
      ]);

      setServices(srvRes.services);
      const editMap: Record<string, string> = {};
      for (const s of srvRes.services) {
        editMap[s._id] = s.priceFcfa !== null && s.priceFcfa !== undefined ? String(s.priceFcfa) : '';
      }
      setPriceEdits(editMap);
      setPayments(payRes.payments);
      setPatients(patRes.patients);

      if (patRes.patients[0] && !payForm.patientId) {
        setPayForm((f) => ({ ...f, patientId: patRes.patients[0]._id }));
      }
    } catch (err: any) {
      if (!silent) notify('error', err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [startDate, endDate]);

  useLiveSync(['payment', 'service'], () => load(true));

  // Sync URL -> new payment & installment modals
  useEffect(() => {
    if (!isRoot) return;
    if (isNewPaymentUrl) {
      if (!canPay) {
        navigate(`/finances/paiements${dateQuery}`, { replace: true });
        return;
      }
      setInstallmentTarget(null);
      setPayForm((f) => ({
        ...f,
        patientId: queryPatientId || f.patientId || patients[0]?._id || '',
      }));
      return;
    }

    if (urlPaymentId) {
      if (!canPay) {
        navigate(`/finances/paiements${dateQuery}`, { replace: true });
        return;
      }
      const match = payments.find((p) => p._id === urlPaymentId);
      if (match && match.remainingBalanceFcfa > 0) {
        setInstallmentTarget(match);
        setInstallmentAmount(String(match.remainingBalanceFcfa));
      } else if (!loading) {
        navigate(`/finances/paiements${dateQuery}`, { replace: true });
      }
      return;
    }

    setInstallmentTarget(null);
  }, [isRoot, isNewPaymentUrl, urlPaymentId, queryPatientId, payments, patients, loading, canPay]);

  const handleServiceSelect = (serviceId: string) => {
    const srv = services.find((s) => s._id === serviceId);
    setPayForm((f) => ({
      ...f,
      serviceId,
      serviceName: srv?.name || '',
      totalAmountFcfa: srv?.priceFcfa !== null && srv?.priceFcfa !== undefined ? String(srv.priceFcfa) : '',
      amountPaidFcfa: srv?.priceFcfa !== null && srv?.priceFcfa !== undefined ? String(srv.priceFcfa) : '',
    }));
  };

  const handleCreatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/payments', {
        method: 'POST',
        body: JSON.stringify({
          patientId: payForm.patientId,
          serviceId: payForm.serviceId || undefined,
          serviceName: payForm.serviceName,
          totalAmountFcfa: Number(payForm.totalAmountFcfa),
          amountPaidFcfa: Number(payForm.amountPaidFcfa),
          method: payForm.method,
          date: payForm.date,
          notes: payForm.notes,
        }),
      });
      notify('success', 'Paiement enregistré et reçu généré.');
      closeModal();
      await load();
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleInstallment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!installmentTarget) return;
    setSaving(true);
    try {
      await apiFetch(`/api/payments/${installmentTarget._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ additionalPaidFcfa: Number(installmentAmount) }),
      });
      notify('success', 'Complément de paiement enregistré.');
      setInstallmentAmount('');
      closeModal();
      await load();
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveServicePrice = async (s: MedicalService) => {
    const raw = priceEdits[s._id];
    const priceFcfa = raw === '' ? null : Number(raw);
    if (priceFcfa !== null && (Number.isNaN(priceFcfa) || priceFcfa < 0)) {
      notify('error', 'Montant FCFA invalide.');
      return;
    }
    try {
      await apiFetch(`/api/services/${s._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ priceFcfa }),
      });
      notify('success', `Tarif mis à jour pour ${s.name}.`);
      await load();
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const monthPrefix = today.slice(0, 7);
  const dailyRevenue = payments.filter((p) => p.date === today && p.status !== 'ANNULE').reduce((a, b) => a + b.amountPaidFcfa, 0);
  const monthlyRevenue = payments.filter((p) => p.date.startsWith(monthPrefix) && p.status !== 'ANNULE').reduce((a, b) => a + b.amountPaidFcfa, 0);
  const totalBalance = payments.filter((p) => p.status !== 'ANNULE').reduce((a, b) => a + b.remainingBalanceFcfa, 0);

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          <button
            type="button"
            onClick={() => setTab('payments')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium ${
              tab === 'payments' ? 'bg-white dark:bg-slate-900 text-[#073B70] dark:text-sky-300 shadow-xs' : 'text-[#708197]'
            }`}
          >
            Encaissements & Reçus
          </button>
          <button
            type="button"
            onClick={() => setTab('services')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium ${
              tab === 'services' ? 'bg-white dark:bg-slate-900 text-[#073B70] dark:text-sky-300 shadow-xs' : 'text-[#708197]'
            }`}
          >
            Grille des prestations (FCFA)
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasPerm(user, 'payments:read') && (
            <>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await apiFetch<{ payments: Payment[] }>(
                      `/api/payments?startDate=${today}&endDate=${today}`
                    );
                    downloadFinancialReportPdf(
                      res.payments,
                      formatDateFr(today),
                      'Rapport financier journalier',
                      `Rapport-Journalier-${today}`
                    );
                    notify('success', 'Rapport journalier PDF généré.');
                  } catch (err: any) {
                    notify('error', err.message);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Download className="w-3.5 h-3.5 text-[#1265A3]" />
                Rapport du jour (PDF)
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const monthStart = `${monthPrefix}-01`;
                    const res = await apiFetch<{ payments: Payment[] }>(
                      `/api/payments?startDate=${monthStart}&endDate=${today}`
                    );
                    downloadFinancialReportPdf(
                      res.payments,
                      `Mois ${monthPrefix}`,
                      'Rapport financier mensuel',
                      `Rapport-Mensuel-${monthPrefix}`
                    );
                    notify('success', 'Rapport mensuel PDF généré.');
                  } catch (err: any) {
                    notify('error', err.message);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Download className="w-3.5 h-3.5 text-[#073B70] dark:text-sky-300" />
                Rapport du mois (PDF)
              </button>
            </>
          )}
          {canPay && (
            <button
              type="button"
              onClick={() => navigate(`/finances/nouveau-paiement${dateQuery}`)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              Enregistrer un paiement
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Recettes du jour" value={formatFcfa(dailyRevenue)} tone="primary" />
        <StatCard label="Recettes du mois en cours" value={formatFcfa(monthlyRevenue)} tone="success" />
        <StatCard label="Soldes restants à percevoir" value={formatFcfa(totalBalance)} tone={totalBalance > 0 ? 'warning' : 'default'} />
      </div>

      {loading ? (
        <TableSkeleton rows={5} />
      ) : tab === 'payments' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-3">
            <span className="text-xs text-[#708197] font-medium">Filtrer par date :</span>
            <input type="date" value={startDate} onChange={(e) => setDateRange(e.target.value, endDate)} className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs" />
            <span className="text-xs text-[#708197]">au</span>
            <input type="date" value={endDate} onChange={(e) => setDateRange(startDate, e.target.value)} className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs" />
            {(startDate || endDate) && (
              <button type="button" onClick={() => setDateRange('', '')} className="text-xs text-[#1265A3] hover:underline">
                Réinitialiser
              </button>
            )}
          </div>

          {payments.length === 0 ? (
            <EmptyState
              title="Aucun paiement enregistré sur cette période"
              description="Enregistrez un règlement complet ou partiel pour générer un reçu officiel en FCFA."
              actionLabel={canPay ? 'Enregistrer un paiement' : undefined}
              onAction={canPay ? () => navigate(`/finances/nouveau-paiement${dateQuery}`) : undefined}
            />
          ) : (
            <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs text-[#708197] border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-4 py-3 font-medium">Reçu</th>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Patient</th>
                      <th className="px-4 py-3 font-medium">Prestation</th>
                      <th className="px-4 py-3 font-medium text-right">Réglé / Total</th>
                      <th className="px-4 py-3 font-medium">Statut</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {payments.map((p) => (
                      <tr key={p._id} className="hover:bg-[#EAF4FC]/30 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-[#073B70] dark:text-sky-300 tabular-nums">
                          {p.receiptNumber}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs tabular-nums">{formatDateFr(p.date)}</td>
                        <td className="px-4 py-3 text-xs font-semibold">{p.patientName}</td>
                        <td className="px-4 py-3 text-xs">
                          <div>{p.serviceName}</div>
                          <div className="text-[11px] text-[#708197]">{p.method}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                          <div className="font-semibold">{formatFcfa(p.amountPaidFcfa)}</div>
                          <div className="text-[11px] text-[#708197]">sur {formatFcfa(p.totalAmountFcfa)}</div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge
                            label={p.status === 'PAYE' ? 'Payé' : p.status === 'PARTIEL' ? 'Partiel' : 'Impayé'}
                            tone={p.status === 'PAYE' ? 'success' : p.status === 'PARTIEL' ? 'warning' : 'danger'}
                          />
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                          {canPay && p.remainingBalanceFcfa > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                navigate(`/finances/paiements/${encodeURIComponent(p._id)}/complement${dateQuery}`)
                              }
                              className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs font-medium"
                            >
                              Solder ({formatFcfa(p.remainingBalanceFcfa)})
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => downloadPaymentReceiptPdf(p)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#EAF4FC] text-[#073B70] text-xs font-medium"
                          >
                            <Download className="w-3.5 h-3.5" /> Reçu PDF
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 text-xs text-[#708197]">
            <Settings2 className="w-4 h-4 text-[#1265A3]" />
            <span>
              Les tarifs en FCFA ne sont jamais inventés automatiquement : ils sont configurés uniquement par l'administrateur du cabinet.
            </span>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {services.map((s) => (
              <div key={s._id} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-sm">{s.name}</div>
                  <div className="text-xs font-mono text-[#708197]">{s.code} · {s.category}</div>
                </div>
                <div className="flex items-center gap-2">
                  {isAdmin ? (
                    <>
                      <input
                        type="number"
                        min={0}
                        placeholder="Tarif FCFA"
                        value={priceEdits[s._id] ?? ''}
                        onChange={(e) => setPriceEdits({ ...priceEdits, [s._id]: e.target.value })}
                        className="w-36 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono tabular-nums"
                      />
                      <button
                        type="button"
                        onClick={() => saveServicePrice(s)}
                        className="px-3 py-1.5 rounded-lg bg-[#073B70] text-white text-xs font-medium"
                      >
                        Enregistrer
                      </button>
                    </>
                  ) : (
                    <span className="font-mono text-sm font-semibold tabular-nums">
                      {formatFcfa(s.priceFcfa)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New Payment Modal */}
      <Modal open={isNewPaymentUrl} onClose={closeModal} title="Enregistrer un paiement (FCFA)" maxWidth="max-w-md">
        <form onSubmit={handleCreatePayment} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Patient *</label>
            <select required value={payForm.patientId} onChange={(e) => setPayForm({ ...payForm, patientId: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm">
              {patients.map((p) => (
                <option key={p._id} value={p._id}>{p.patientNumber} — {p.firstName} {p.lastName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Prestation du catalogue</label>
            <select value={payForm.serviceId} onChange={(e) => handleServiceSelect(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm">
              <option value="">Sélectionner une prestation...</option>
              {services.map((s) => (
                <option key={s._id} value={s._id}>{s.name} ({formatFcfa(s.priceFcfa)})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Libellé prestation *</label>
            <input type="text" required value={payForm.serviceName} onChange={(e) => setPayForm({ ...payForm, serviceName: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Montant total (FCFA) *</label>
              <input type="number" min={0} required value={payForm.totalAmountFcfa} onChange={(e) => setPayForm({ ...payForm, totalAmountFcfa: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Montant versé (FCFA) *</label>
              <input type="number" min={0} required value={payForm.amountPaidFcfa} onChange={(e) => setPayForm({ ...payForm, amountPaidFcfa: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Mode de paiement</label>
              <select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value as PaymentMethod })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm">
                <option value="ESPECES">Espèces</option>
                <option value="MOBILE_MONEY">Mobile Money</option>
                <option value="CARTE">Carte bancaire</option>
                <option value="VIREMENT">Virement</option>
                <option value="CHEQUE">Chèque</option>
                <option value="ASSURANCE">Assurance</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Date</label>
              <input type="date" required value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700">Annuler</button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-[#073B70] text-white font-medium">
              <CreditCard className="w-4 h-4" /> Enregistrer
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(urlPaymentId && installmentTarget)} onClose={closeModal} title={`Complément — ${installmentTarget?.receiptNumber}`} maxWidth="max-w-sm">
        <form onSubmit={handleInstallment} className="space-y-4">
          <div className="text-xs text-[#708197]">Solde restant : <strong className="font-mono text-[#172B45] dark:text-white">{formatFcfa(installmentTarget?.remainingBalanceFcfa)}</strong></div>
          <div>
            <label className="block text-xs font-medium mb-1">Montant encaissé (FCFA)</label>
            <input type="number" min={1} max={installmentTarget?.remainingBalanceFcfa} required value={installmentAmount} onChange={(e) => setInstallmentAmount(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700">Annuler</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white font-medium">Valider</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
