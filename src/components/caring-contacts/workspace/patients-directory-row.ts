import type { PatientId, PlanId, ReferralId } from "@/lib/caring-contacts/ids";
import type { PlanState } from "@/lib/caring-contacts/model";

/** The complete, deliberately narrow value allowed across the Patients client boundary. */
export type PatientsDirectoryRow = Readonly<{
  planId: PlanId;
  patientId: PatientId;
  referralId: ReferralId;
  state: PlanState;
  patientName: string | null;
  dischargeDay: string;
  scheduledContactCount: number;
  absorbedContactCount: number;
  otherSuppressedContactCount: number;
}>;
