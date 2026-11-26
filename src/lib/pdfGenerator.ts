import { jsPDF } from 'jspdf';
import { CLINIC_DEFAULTS, EXAMINATION_TYPE_LABELS } from '../shared/constants';
import type { Consultation, Patient, Payment, Prescription } from '../shared/types';
import { calculateAge, formatDateFr, formatFcfa } from './api';

export function downloadConsultationPdf(consultation: Consultation, patient?: Patient) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 18;

  // Header
  doc.setFillColor(7, 59, 112); // #073B70
  doc.rect(0, 0, 210, 32, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(CLINIC_DEFAULTS.clinicName, 14, 14);
  doc.setFontSize(9.5);
  doc.text(`${CLINIC_DEFAULTS.leadDoctorName} — ${CLINIC_DEFAULTS.specialty}`, 14, 20);
  doc.text(`${CLINIC_DEFAULTS.address} · ${CLINIC_DEFAULTS.city} · Tél: ${CLINIC_DEFAULTS.phone}`, 14, 26);

  y = 42;
  doc.setTextColor(23, 43, 69);
  doc.setFontSize(14);
  doc.text('COMPTE RENDU DE CONSULTATION CARDIOLOGIQUE', 14, y);
  y += 7;

  doc.setFontSize(10);
  doc.setTextColor(112, 129, 151);
  doc.text(
    `Date : ${formatDateFr(consultation.date)} à ${consultation.time}   |   Statut : ${
      consultation.status === 'VALIDEE' ? 'Validé médicalement' : 'Brouillon'
    }`,
    14,
    y
  );
  y += 8;

  // Patient box
  doc.setDrawColor(215, 224, 235);
  doc.setFillColor(244, 247, 251);
  doc.roundedRect(14, y, 182, 22, 2, 2, 'FD');
  doc.setTextColor(23, 43, 69);
  doc.setFontSize(10.5);
  doc.text(
    `Patient : ${consultation.patientName || (patient ? `${patient.firstName} ${patient.lastName}` : '')}`,
    18,
    y + 7
  );
  doc.setFontSize(9.5);
  doc.text(
    `Identifiant : ${consultation.patientNumber || patient?.patientNumber || '—'}   ·   Âge : ${
      patient ? calculateAge(patient.birthDate) : '—'
    }   ·   Tél : ${patient?.phone || '—'}`,
    18,
    y + 13
  );
  doc.text(`Médecin : ${consultation.doctorName || CLINIC_DEFAULTS.leadDoctorName}`, 18, y + 19);
  y += 30;

  const addSection = (title: string, content?: string) => {
    if (!content?.trim()) return;
    if (y > 265) {
      doc.addPage();
      y = 20;
    }
    doc.setFontSize(10.5);
    doc.setTextColor(7, 59, 112);
    doc.text(title, 14, y);
    y += 5;
    doc.setFontSize(9.5);
    doc.setTextColor(23, 43, 69);
    const lines = doc.splitTextToSize(content.trim(), 180);
    doc.text(lines, 14, y);
    y += lines.length * 4.8 + 4;
  };

  addSection('Motif de consultation', consultation.reason);
  addSection('Histoire de la maladie & Symptômes', [consultation.illnessHistory, consultation.symptoms].filter(Boolean).join('\n'));

  const v = consultation.vitals || {};
  const vitalsSummary = [
    v.systolicBP && v.diastolicBP ? `TA : ${v.systolicBP}/${v.diastolicBP} mmHg` : null,
    v.heartRate ? `FC : ${v.heartRate} bpm` : null,
    v.oxygenSaturation ? `SpO2 : ${v.oxygenSaturation}%` : null,
    v.temperature ? `Temp : ${v.temperature} °C` : null,
    v.weight ? `Poids : ${v.weight} kg` : null,
    v.height ? `Taille : ${v.height} cm` : null,
    v.bmi ? `IMC : ${v.bmi}` : null,
  ]
    .filter(Boolean)
    .join('   |   ');
  addSection('Constantes cliniques', vitalsSummary);

  addSection('Examen clinique & Observations', [consultation.clinicalExam, consultation.observations].filter(Boolean).join('\n'));
  addSection('Diagnostic retenu / Hypothèses', consultation.confirmedDiagnosis || consultation.diagnosticHypotheses);

  if (consultation.prescribedExams?.length) {
    addSection(
      'Examens cardiologiques prescrits',
      consultation.prescribedExams.map((t) => `• ${EXAMINATION_TYPE_LABELS[t] || t}`).join('\n')
    );
  }

  if (consultation.prescriptionLines?.length) {
    const rx = consultation.prescriptionLines
      .map((l, idx) => `${idx + 1}. ${l.medication} ${l.dosage} — ${l.frequency} (${l.duration})${l.instructions ? ` · ${l.instructions}` : ''}`)
      .join('\n');
    addSection('Prescription thérapeutique', rx);
  } else {
    addSection('Traitements', consultation.treatmentsText);
  }

  addSection('Recommandations & Suivi', [
    consultation.recommendations,
    consultation.nextControlDate ? `Prochain contrôle conseillé : ${formatDateFr(consultation.nextControlDate)}` : '',
  ]
    .filter(Boolean)
    .join('\n'));

  // Footer
  doc.setFontSize(8.5);
  doc.setTextColor(112, 129, 151);
  doc.text(`« ${CLINIC_DEFAULTS.slogan} »`, 14, 286);

  doc.save(`Compte-Rendu-${consultation.patientNumber || 'Patient'}-${consultation.date}.pdf`);
}

export function downloadPaymentReceiptPdf(payment: Payment) {
  const doc = new jsPDF({ unit: 'mm', format: 'a5' });
  doc.setFillColor(7, 59, 112);
  doc.rect(0, 0, 148, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.text(CLINIC_DEFAULTS.clinicName, 10, 11);
  doc.setFontSize(8);
  doc.text(`${CLINIC_DEFAULTS.address} · ${CLINIC_DEFAULTS.city}`, 10, 17);
  doc.text(`Tél : ${CLINIC_DEFAULTS.phone} · ${CLINIC_DEFAULTS.email}`, 10, 22);

  let y = 36;
  doc.setTextColor(23, 43, 69);
  doc.setFontSize(13);
  doc.text(`REÇU DE PAIEMENT N° ${payment.receiptNumber}`, 10, y);
  y += 8;

  doc.setFontSize(9.5);
  const rows: Array<[string, string]> = [
    ['Date', formatDateFr(payment.date)],
    ['Patient', `${payment.patientName || ''} (${payment.patientNumber || ''})`],
    ['Prestation', payment.serviceName],
    ['Mode de paiement', payment.method],
    ['Montant total', formatFcfa(payment.totalAmountFcfa)],
    ['Montant réglé', formatFcfa(payment.amountPaidFcfa)],
    ['Solde restant', formatFcfa(payment.remainingBalanceFcfa)],
    ['Statut', payment.status],
    ['Encaissé par', payment.recordedByName || 'Accueil'],
  ];

  for (const [k, v] of rows) {
    doc.setTextColor(112, 129, 151);
    doc.text(k, 10, y);
    doc.setTextColor(23, 43, 69);
    doc.text(String(v), 58, y);
    y += 7;
  }

  y += 6;
  doc.setDrawColor(220, 226, 234);
  doc.line(10, y, 138, y);
  y += 7;
  doc.setFontSize(8);
  doc.setTextColor(112, 129, 151);
  doc.text(`« ${CLINIC_DEFAULTS.slogan} »`, 10, y);

  doc.save(`Recu-${payment.receiptNumber}.pdf`);
}

export function downloadPatientSummaryPdf(patient: Patient) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.setFillColor(7, 59, 112);
  doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.text(CLINIC_DEFAULTS.clinicName, 14, 13);
  doc.setFontSize(9.5);
  doc.text(`CARDIO ERP — Fiche Administrative Patient · ${CLINIC_DEFAULTS.city}`, 14, 21);

  let y = 40;
  doc.setTextColor(23, 43, 69);
  doc.setFontSize(14);
  doc.text(`${patient.firstName} ${patient.lastName} (${patient.patientNumber})`, 14, y);
  y += 10;

  doc.setFontSize(10);
  const fields: Array<[string, string]> = [
    ['Sexe', patient.gender === 'M' ? 'Masculin' : 'Féminin'],
    ['Date de naissance', `${formatDateFr(patient.birthDate)} (${calculateAge(patient.birthDate)})`],
    ['Téléphone', patient.phone],
    ['E-mail', patient.email || '—'],
    ['Adresse', patient.address || '—'],
    ['Profession', patient.profession || '—'],
    ['Groupe sanguin', patient.bloodGroup || '—'],
    ['Contact urgence', `${patient.emergencyContactName || '—'} · ${patient.emergencyContactPhone || ''}`],
    ['Statut dossier', patient.status],
    ['Date de création', formatDateFr(patient.createdAt)],
  ];

  for (const [label, value] of fields) {
    doc.setTextColor(112, 129, 151);
    doc.text(label, 14, y);
    doc.setTextColor(23, 43, 69);
    doc.text(value, 65, y);
    y += 7.5;
  }

  doc.save(`Fiche-${patient.patientNumber}.pdf`);
}

export function downloadFinancialReportPdf(
  payments: Payment[],
  periodLabel: string,
  reportTitle: string,
  fileSlug: string
) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.setFillColor(7, 59, 112);
  doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.text(CLINIC_DEFAULTS.clinicName, 14, 13);
  doc.setFontSize(9.5);
  doc.text(`CARDIO ERP — ${reportTitle} · ${CLINIC_DEFAULTS.city}`, 14, 21);

  const activePayments = payments.filter((p) => p.status !== 'ANNULE');
  const totalBilled = activePayments.reduce((acc, p) => acc + p.totalAmountFcfa, 0);
  const totalCollected = activePayments.reduce((acc, p) => acc + p.amountPaidFcfa, 0);
  const totalPending = activePayments.reduce((acc, p) => acc + p.remainingBalanceFcfa, 0);

  let y = 38;
  doc.setTextColor(23, 43, 69);
  doc.setFontSize(13);
  doc.text(`${reportTitle} — ${periodLabel}`, 14, y);
  y += 7;

  doc.setFontSize(9.5);
  doc.setTextColor(112, 129, 151);
  doc.text(
    `Édité le ${formatDateFr(new Date().toISOString().slice(0, 10))} · ${activePayments.length} transaction(s)`,
    14,
    y
  );
  y += 8;

  // Summary Box
  doc.setDrawColor(215, 224, 235);
  doc.setFillColor(244, 247, 251);
  doc.roundedRect(14, y, 182, 20, 2, 2, 'FD');
  doc.setTextColor(23, 43, 69);
  doc.setFontSize(9.5);
  doc.text(`Total facturé : ${formatFcfa(totalBilled)}`, 18, y + 8);
  doc.text(`Total encaissé : ${formatFcfa(totalCollected)}`, 80, y + 8);
  doc.text(`Reste à percevoir : ${formatFcfa(totalPending)}`, 142, y + 8);
  doc.setFontSize(8.5);
  doc.setTextColor(112, 129, 151);
  doc.text('Devise : Francs CFA (XAF) — Cabinet Médical de Cardiologie Paris 16', 18, y + 15);
  y += 28;

  // Table header
  doc.setFillColor(7, 59, 112);
  doc.rect(14, y, 182, 7, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8.5);
  doc.text('Reçu', 16, y + 4.8);
  doc.text('Date', 44, y + 4.8);
  doc.text('Patient', 66, y + 4.8);
  doc.text('Prestation', 106, y + 4.8);
  doc.text('Encaissé', 152, y + 4.8);
  doc.text('Statut', 178, y + 4.8);
  y += 9;

  doc.setFontSize(8.2);
  if (activePayments.length === 0) {
    doc.setTextColor(112, 129, 151);
    doc.text('Aucun encaissement enregistré sur cette période.', 16, y + 4);
  } else {
    for (const p of activePayments) {
      if (y > 272) {
        doc.addPage();
        y = 20;
      }
      doc.setTextColor(23, 43, 69);
      doc.text(p.receiptNumber.slice(0, 14), 16, y);
      doc.text(formatDateFr(p.date), 44, y);
      doc.text((p.patientName || 'Patient').slice(0, 22), 66, y);
      doc.text((p.serviceName || 'Prestation').slice(0, 24), 106, y);
      doc.text(formatFcfa(p.amountPaidFcfa), 152, y);
      doc.text(p.status, 178, y);
      y += 6;
      doc.setDrawColor(235, 240, 246);
      doc.line(14, y - 2, 196, y - 2);
    }
  }

  doc.setFontSize(8);
  doc.setTextColor(112, 129, 151);
  doc.text(`« ${CLINIC_DEFAULTS.slogan} »`, 14, 286);

  doc.save(`${fileSlug}.pdf`);
}

export function downloadPrescriptionPdf(prescription: Prescription, patient?: Patient) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  doc.setFillColor(7, 59, 112);
  doc.rect(0, 0, 210, 32, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(CLINIC_DEFAULTS.clinicName, 14, 14);
  doc.setFontSize(9.5);
  doc.text(`${CLINIC_DEFAULTS.leadDoctorName} — ${CLINIC_DEFAULTS.specialty}`, 14, 20);
  doc.text(`${CLINIC_DEFAULTS.address} · ${CLINIC_DEFAULTS.city} · Tél: ${CLINIC_DEFAULTS.phone}`, 14, 26);

  let y = 42;
  doc.setTextColor(23, 43, 69);
  doc.setFontSize(15);
  doc.text('ORDONNANCE MÉDICALE', 14, y);
  y += 7;

  doc.setFontSize(10);
  doc.setTextColor(112, 129, 151);
  doc.text(`Date : ${formatDateFr(prescription.date)}   |   Prescripteur : ${prescription.doctorName || CLINIC_DEFAULTS.leadDoctorName}`, 14, y);
  y += 8;

  doc.setDrawColor(215, 224, 235);
  doc.setFillColor(244, 247, 251);
  doc.roundedRect(14, y, 182, 18, 2, 2, 'FD');
  doc.setTextColor(23, 43, 69);
  doc.setFontSize(10.5);
  doc.text(
    `Patient : ${patient ? `${patient.firstName} ${patient.lastName}` : 'Patient'} (${patient?.patientNumber || '—'})`,
    18,
    y + 7.5
  );
  doc.setFontSize(9);
  doc.setTextColor(112, 129, 151);
  doc.text(
    `Âge : ${patient ? calculateAge(patient.birthDate) : '—'}   ·   Tél : ${patient?.phone || '—'}`,
    18,
    y + 13.5
  );
  y += 28;

  doc.setTextColor(23, 43, 69);
  doc.setFontSize(10.5);
  prescription.lines.forEach((line, idx) => {
    if (y > 255) {
      doc.addPage();
      y = 20;
    }
    doc.setFontSize(11);
    doc.setTextColor(7, 59, 112);
    doc.text(`${idx + 1}. ${line.medication} ${line.dosage}`, 14, y);
    y += 5.5;
    doc.setFontSize(9.5);
    doc.setTextColor(23, 43, 69);
    const details = `Posologie : ${line.frequency} · Durée : ${line.duration}${line.instructions ? ` — ${line.instructions}` : ''}`;
    const wrapped = doc.splitTextToSize(details, 176);
    doc.text(wrapped, 19, y);
    y += wrapped.length * 5 + 4;
  });

  if (prescription.notes?.trim()) {
    y += 3;
    doc.setFontSize(10);
    doc.setTextColor(7, 59, 112);
    doc.text('Recommandations particulières', 14, y);
    y += 5;
    doc.setFontSize(9.5);
    doc.setTextColor(23, 43, 69);
    const notesLines = doc.splitTextToSize(prescription.notes.trim(), 180);
    doc.text(notesLines, 14, y);
  }

  doc.setFontSize(8.5);
  doc.setTextColor(112, 129, 151);
  doc.text(`« ${CLINIC_DEFAULTS.slogan} »`, 14, 286);

  doc.save(`Ordonnance-${patient?.patientNumber || 'Patient'}-${prescription.date}.pdf`);
}


