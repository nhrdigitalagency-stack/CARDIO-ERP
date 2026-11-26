import { repository } from '../repositories/SupabaseRepository';
import { CLINIC_DEFAULTS, ROLE_PERMISSIONS } from '../../src/shared/constants';
import type { RoleCode } from '../../src/shared/types';

export const STANDARD_CARDIOLOGY_SERVICES = [
  { code: 'SRV-CONS', name: 'Consultation cardiologique', category: 'CONSULTATION' as const },
  { code: 'SRV-ECG', name: 'Électrocardiogramme (ECG)', category: 'ECG' as const },
  { code: 'SRV-HOLTER', name: 'Holter ECG 24h/48h', category: 'HOLTER_ECG' as const },
  { code: 'SRV-MAPA', name: 'Holter tensionnel (MAPA)', category: 'MAPA' as const },
  { code: 'SRV-ECHO', name: 'Échocardiographie Doppler', category: 'ECHOCARDIOGRAPHIE' as const },
  {
    code: 'SRV-ETO',
    name: 'Échographie trans-œsophagienne',
    category: 'ECHOCARDIOGRAPHIE_TRANS_OESOPHAGIENNE' as const,
  },
  { code: 'SRV-VASC', name: 'Écho-Doppler vasculaire', category: 'ECHO_DOPPLER' as const },
  { code: 'SRV-EFF', name: "Épreuve d'effort", category: 'EPREUVE_EFFORT' as const },
  { code: 'SRV-POLY', name: 'Polygraphie ventilatoire', category: 'POLYGRAPHIE_VENTILATOIRE' as const },
];

export async function ensureClinicBaseline(): Promise<{ servicesCreated: number }> {
  const now = new Date().toISOString();

  const existingSettings = await repository.getClinicSettings();
  if (!existingSettings) {
    await repository.upsertClinicSettings({
      clinicName: CLINIC_DEFAULTS.clinicName,
      leadDoctorName: CLINIC_DEFAULTS.leadDoctorName,
      specialty: CLINIC_DEFAULTS.specialty,
      city: CLINIC_DEFAULTS.city,
      phone: CLINIC_DEFAULTS.phone,
      email: CLINIC_DEFAULTS.email,
      address: CLINIC_DEFAULTS.address,
      slogan: CLINIC_DEFAULTS.slogan,
      archivingPolicyYears: 20,
      notificationChannels: {
        emailEnabled: true,
        smsEnabled: false,
        whatsappEnabled: false,
        autoRemindersEnabled: true,
        neverSendSensitiveMedicalData: true,
      },
      updatedAt: now,
    });
  }

  const roleCodes: RoleCode[] = ['ADMIN', 'MEDECIN', 'ACCUEIL', 'PATIENT'];
  const roleNames: Record<RoleCode, string> = {
    ADMIN: 'Administrateur',
    MEDECIN: 'Médecin / Docteur',
    ACCUEIL: 'Accueil / Secrétariat',
    PATIENT: 'Patient',
  };
  for (const code of roleCodes) {
    await repository.upsertRole({
      _id: `role-${code.toLowerCase()}`,
      _type: 'role',
      code,
      name: roleNames[code],
      description: `Rôle système ${roleNames[code]}`,
      permissions: ROLE_PERMISSIONS[code],
      createdAt: now,
      updatedAt: now,
    });
  }

  const existingServices = await repository.listServices();
  const existingCodes = new Set(existingServices.map((s) => s.code));
  let servicesCreated = 0;

  for (const s of STANDARD_CARDIOLOGY_SERVICES) {
    if (existingCodes.has(s.code)) continue;
    await repository.createService({
      ...s,
      priceFcfa: null,
      active: true,
      description: 'Tarif en FCFA à renseigner par l’administrateur du cabinet.',
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    });
    servicesCreated += 1;
  }

  return { servicesCreated };
}
