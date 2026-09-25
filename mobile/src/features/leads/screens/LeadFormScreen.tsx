import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';
import { Button, ChipGroup, ErrorState, Input, LoadingView, Screen, Text, toOptions } from '@/components';
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
  const lastNameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);

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
        <Input
          label="First name"
          icon="person-outline"
          value={values.fname}
          onChangeText={set('fname')}
          autoCapitalize="words"
          autoComplete="given-name"
          textContentType="givenName"
          returnKeyType="next"
          onSubmitEditing={() => lastNameRef.current?.focus()}
          error={errors.fname}
          editable={!save.isPending}
        />
        <Input
          ref={lastNameRef}
          label="Last name"
          icon="person-outline"
          value={values.lname}
          onChangeText={set('lname')}
          autoCapitalize="words"
          autoComplete="family-name"
          textContentType="familyName"
          returnKeyType="next"
          onSubmitEditing={() => emailRef.current?.focus()}
          error={errors.lname}
          editable={!save.isPending}
        />
        <Input
          ref={emailRef}
          label="Email"
          icon="mail-outline"
          value={values.email}
          onChangeText={set('email')}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => phoneRef.current?.focus()}
          error={errors.email}
          editable={!save.isPending}
        />
        <Input
          ref={phoneRef}
          label="Phone"
          icon="call-outline"
          value={values.phone}
          onChangeText={set('phone')}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          error={errors.phone}
          hint="Include the country code"
          editable={!save.isPending}
        />

        <ChipGroup
          label="Priority"
          options={toOptions(PRIORITIES)}
          value={priority}
          onSelect={(p) => setPriority(priority === p ? undefined : p)}
        />

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
