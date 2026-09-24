import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, ErrorState, Input, LoadingView, Screen, Text } from '@/components';
import { queryKeys } from '@/constants/queryKeys';
import type { AppStackParamList } from '@/navigation/types';
import { errorMessage, isApiError } from '@/services/api/errors';
import { selectUser, useSessionStore } from '@/store/sessionStore';
import { toast } from '@/store/uiStore';
import { useTheme } from '@/theme/ThemeProvider';
import { createLead, updateLead } from '../api';
import { useLead } from '../hooks';
import { hasErrors, validateLeadForm, type LeadFormErrors, type LeadFormValues } from '../leadValidation';
import { PRIORITIES, type LeadDetail } from '../types';

/** Create a lead (no params) or edit one (`leadId`). */
export function LeadFormScreen() {
  const { params } = useRoute<RouteProp<AppStackParamList, 'LeadForm'>>();
  const editingId = params?.leadId;
  // Only fetch when editing; creating has nothing to load.
  const existing = useLead(editingId ?? 0, !!editingId);

  if (editingId && existing.isPending) {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }
  if (editingId && !existing.data) {
    return (
      <Screen>
        <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />
      </Screen>
    );
  }

  // The body mounts only once the lead is loaded, so its form state is initialised from it directly
  // (no effect to copy server data into state).
  return <LeadFormBody editingId={editingId} initial={existing.data?.data} />;
}

function LeadFormBody({ editingId, initial }: { editingId?: number; initial?: LeadDetail }) {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const client = useQueryClient();
  const user = useSessionStore(selectUser);
  const { spacing } = useTheme();

  const [values, setValues] = useState<LeadFormValues>(() => ({
    fname: initial?.fname ?? '',
    lname: initial?.lname ?? '',
    email: initial?.email ?? '',
    phone: initial?.mobile || initial?.phone || '',
  }));
  const [priority, setPriority] = useState<string | undefined>(initial?.priority ?? undefined);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<LeadFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicateId, setDuplicateId] = useState<number | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      if (editingId) {
        await updateLead(editingId, { ...values, priority });
        return editingId;
      }
      const created = await createLead({ ...values, priority, notes }, user!);
      return created.id;
    },
    onSuccess: (id) => {
      void client.invalidateQueries({ queryKey: queryKeys.leads });
      toast.success(editingId ? 'Lead updated' : 'Lead created');
      if (editingId) navigation.goBack();
      else navigation.replace('LeadDetail', { leadId: id });
    },
    onError: (error) => {
      if (isApiError(error) && error.kind === 'conflict') {
        const body = error.body as { duplicateLeadId?: number } | undefined;
        setDuplicateId(body?.duplicateLeadId ?? null);
      }
      setFormError(isApiError(error) && error.details.length ? error.details.join('\n') : errorMessage(error, 'Unable to save the lead.'));
    },
  });

  const set = (key: keyof LeadFormValues) => (text: string) => {
    setValues((v) => ({ ...v, [key]: text }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = () => {
    const found = validateLeadForm(values);
    setErrors(found);
    setFormError(null);
    setDuplicateId(null);
    if (hasErrors(found) || !user) return;
    save.mutate();
  };

  return (
    <Screen scroll keyboardAvoiding>
      <View style={{ gap: spacing.md }}>
        <Input label="First name" value={values.fname} onChangeText={set('fname')} autoCapitalize="words" error={errors.fname} editable={!save.isPending} />
        <Input label="Last name" value={values.lname} onChangeText={set('lname')} autoCapitalize="words" error={errors.lname} editable={!save.isPending} />
        <Input label="Email" value={values.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} error={errors.email} editable={!save.isPending} />
        <Input label="Phone" value={values.phone} onChangeText={set('phone')} keyboardType="phone-pad" error={errors.phone} hint="Include the country code" editable={!save.isPending} />

        <View>
          <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
            Priority
          </Text>
          <View style={{ flexDirection: 'row' }}>
            {PRIORITIES.map((p) => (
              <Chip key={p} label={p} selected={priority === p} onPress={() => setPriority(priority === p ? undefined : p)} />
            ))}
          </View>
        </View>

        {!editingId ? <Input label="Notes (optional)" value={notes} onChangeText={setNotes} multiline editable={!save.isPending} /> : null}

        {formError ? (
          <Text tone="danger" accessibilityRole="alert">
            {formError}
          </Text>
        ) : null}
        {duplicateId ? <Button title="Open the existing lead" variant="secondary" onPress={() => navigation.replace('LeadDetail', { leadId: duplicateId })} fullWidth /> : null}

        <Button title={editingId ? 'Save changes' : 'Create lead'} onPress={submit} loading={save.isPending} fullWidth />
      </View>
    </Screen>
  );
}
