import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Button, ChipGroup, DateTimeField, Input, Screen, Text, toOptions } from '@/components';
import { queryKeys } from '@/constants/queryKeys';
import { useLead } from '@/features/leads/hooks';
import type { AppStackParamList } from '@/navigation/types';
import { errorMessage } from '@/services/api/errors';
import type { PickedFile } from '@/services/api/upload';
import { toast } from '@/store/uiStore';
import { useTheme } from '@/theme/ThemeProvider';
import { submitPayment, uploadPaymentProof } from '../api';
import type { PaymentMethod, PaymentStructure } from '../types';

const STRUCTURES = ['full', 'installment', 'milestone'] as const;
const METHODS = ['cash', 'card', 'bank_transfer', 'cheque', 'online'] as const;
const METHOD_LABELS: Record<PaymentMethod, string> = { cash: 'Cash', card: 'Card', bank_transfer: 'Bank transfer', cheque: 'Cheque', online: 'Online' };

/**
 * Payment stage of the Opportunity Flow (mirrors the web wizard's PaymentStage) - this
 * is also where crm_opportunities gets created (submitPayment -> POST /api/lead-to-opportunity).
 * Reachable from a lead that doesn't have an opportunity yet.
 */
export function PaymentSubmissionScreen() {
  const { params } = useRoute<RouteProp<AppStackParamList, 'PaymentSubmission'>>();
  const navigation = useNavigation<NavigationProp<AppStackParamList>>();
  const client = useQueryClient();
  const { spacing } = useTheme();
  const leadId = params.leadId;
  const lead = useLead(leadId).data?.data;

  const [opportunityName, setOpportunityName] = useState('');
  const [serviceRequired, setServiceRequired] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [structure, setStructure] = useState<PaymentStructure>('full');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [transactionId, setTransactionId] = useState('');
  const [paymentDate, setPaymentDate] = useState<Date>(new Date());
  const [remark, setRemark] = useState('');
  const [proof, setProof] = useState<{ file: PickedFile; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async (file: PickedFile) => ({ file, url: await uploadPaymentProof(leadId, file) }),
    onSuccess: (result) => {
      setProof(result);
      toast.success('Proof of payment attached');
    },
    onError: (e) => Alert.alert('Upload failed', errorMessage(e, 'Could not upload the file.')),
  });

  const submit = useMutation({
    mutationFn: () => {
      const paid = Number(paidAmount || 0);
      return submitPayment({
        leadId,
        opportunityName: opportunityName.trim(),
        serviceRequired: serviceRequired.trim(),
        totalAmount: Number(totalAmount),
        discountAmount: discountAmount ? Number(discountAmount) : 0,
        paidAmount: paid,
        paymentStructure: structure,
        paymentMethod: method,
        transactionId: transactionId.trim() || undefined,
        paymentDate: paymentDate.toISOString().slice(0, 10),
        proofOfPaymentUrl: proof?.url,
        remark: remark.trim() || undefined,
      });
    },
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: queryKeys.leadDetail(leadId) });
      void client.invalidateQueries({ queryKey: queryKeys.leads });
      toast.success(result.message);
      navigation.navigate('LeadDetail', { leadId });
    },
    onError: (e) => setError(errorMessage(e, 'Unable to submit the payment.')),
  });

  const pickProof = () => {
    Alert.alert('Add proof of payment', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Take photo', onPress: () => void takePhoto() },
      { text: 'Choose file', onPress: () => void pickDocument() },
    ]);
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera permission needed', 'Allow camera access in Settings to photograph the proof of payment.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    const asset = result.canceled ? null : result.assets[0];
    if (asset) uploadMutation.mutate({ uri: asset.uri, name: asset.fileName || `payment-${Date.now()}.jpg`, type: asset.mimeType || 'image/jpeg' });
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['image/*', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      copyToCacheDirectory: true,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (asset) uploadMutation.mutate({ uri: asset.uri, name: asset.name, type: asset.mimeType || 'application/octet-stream' });
  };

  const canSubmit =
    opportunityName.trim().length > 0 &&
    serviceRequired.trim().length > 0 &&
    Number(totalAmount) > 0 &&
    Number(paidAmount || 0) >= 0 &&
    Number(paidAmount || 0) <= Number(totalAmount || 0) &&
    (Number(paidAmount || 0) === 0 || !!proof) &&
    !submit.isPending;

  return (
    <Screen scroll keyboardAvoiding>
      <View style={{ gap: spacing.md }}>
        <Text tone="muted">
          Converts {lead ? lead.fname || 'this lead' : 'this lead'} into an opportunity by recording its first payment - the same step the web
          Opportunity Flow wizard uses.
        </Text>

        <Input label="Opportunity name" value={opportunityName} onChangeText={setOpportunityName} editable={!submit.isPending} />
        <Input
          label="Service"
          value={serviceRequired}
          onChangeText={setServiceRequired}
          editable={!submit.isPending}
          hint={lead?.service_interest_label ? `Lead's program: ${lead.service_interest_label}` : undefined}
        />
        <Input label="Total amount" value={totalAmount} onChangeText={setTotalAmount} keyboardType="decimal-pad" editable={!submit.isPending} />
        <Input label="Discount (optional)" value={discountAmount} onChangeText={setDiscountAmount} keyboardType="decimal-pad" editable={!submit.isPending} />
        <Input label="Paid amount" value={paidAmount} onChangeText={setPaidAmount} keyboardType="decimal-pad" editable={!submit.isPending} />

        <ChipGroup label="Payment structure" options={toOptions(STRUCTURES)} value={structure} onSelect={setStructure} />
        <ChipGroup label="Payment method" options={METHODS.map((value) => ({ value, label: METHOD_LABELS[value] }))} value={method} onSelect={setMethod} />

        <Input label="Transaction / reference ID (optional)" value={transactionId} onChangeText={setTransactionId} editable={!submit.isPending} />
        <DateTimeField label="Payment date" value={paymentDate} onChange={setPaymentDate} mode="date" />

        <View>
          <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
            Proof of payment {Number(paidAmount || 0) > 0 ? '(required)' : '(optional)'}
          </Text>
          <Button
            title={proof ? proof.file.name : 'Add proof of payment'}
            icon={proof ? 'checkmark-circle' : 'camera'}
            variant={proof ? 'secondary' : 'outline'}
            onPress={pickProof}
            loading={uploadMutation.isPending}
            fullWidth
          />
        </View>

        <Input label="Remark (optional)" value={remark} onChangeText={setRemark} multiline editable={!submit.isPending} />

        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        <Button title="Submit payment" onPress={() => void submit.mutateAsync()} loading={submit.isPending} disabled={!canSubmit} fullWidth />
      </View>
    </Screen>
  );
}
