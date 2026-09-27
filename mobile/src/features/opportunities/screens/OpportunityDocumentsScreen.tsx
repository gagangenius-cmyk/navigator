import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Badge, Button, Card, DateTimeField, Input, LoadingView, Screen, Text } from '@/components';
import { useLead } from '@/features/leads/hooks';
import type { AppStackParamList } from '@/navigation/types';
import { errorMessage } from '@/services/api/errors';
import type { PickedFile } from '@/services/api/upload';
import { toast } from '@/store/uiStore';
import { useTheme } from '@/theme/ThemeProvider';
import { fetchOpportunityDocuments, submitForCompliance, uploadOpportunityDocument } from '../api';
import { DOCUMENT_CATEGORIES, type DocumentCategory } from '../types';

const pickFile = (onPicked: (file: PickedFile) => void) => {
  Alert.alert('Add document', undefined, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Take photo',
      onPress: () =>
        void (async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) {
            Alert.alert('Camera permission needed', 'Allow camera access in Settings to photograph the document.');
            return;
          }
          const result = await ImagePicker.launchCameraAsync({ quality: 0.6 });
          const asset = result.canceled ? null : result.assets[0];
          if (asset) onPicked({ uri: asset.uri, name: asset.fileName || `document-${Date.now()}.jpg`, type: asset.mimeType || 'image/jpeg' });
        })(),
    },
    {
      text: 'Choose file',
      onPress: () =>
        void (async () => {
          const result = await DocumentPicker.getDocumentAsync({
            type: ['image/*', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
            copyToCacheDirectory: true,
          });
          const asset = result.canceled ? null : result.assets[0];
          if (asset) onPicked({ uri: asset.uri, name: asset.name, type: asset.mimeType || 'application/octet-stream' });
        })(),
    },
  ]);
};

/**
 * Documents + Signed Agreement + Compliance submission stages of the Opportunity
 * Flow, combined into one screen for mobile's first pass (the web wizard paces
 * these as 3 separate stages, but functionally the compliance submission just
 * needs the signed agreement's URL plus a couple of optional fields).
 */
export function OpportunityDocumentsScreen() {
  const { params } = useRoute<RouteProp<AppStackParamList, 'OpportunityDocuments'>>();
  const navigation = useNavigation<NavigationProp<AppStackParamList>>();
  const client = useQueryClient();
  const { spacing } = useTheme();
  const { leadId, opportunityId } = params;
  const lead = useLead(leadId).data?.data;

  const [clientSignature, setClientSignature] = useState('');
  const [signatureDate, setSignatureDate] = useState<Date>(new Date());
  const [conversationSummary, setConversationSummary] = useState('');
  const [error, setError] = useState<string | null>(null);

  const docsQuery = useQuery({
    queryKey: ['opportunity-documents', opportunityId],
    queryFn: () => fetchOpportunityDocuments(opportunityId),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ category, file }: { category: DocumentCategory; file: PickedFile }) => uploadOpportunityDocument(opportunityId, category, file),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['opportunity-documents', opportunityId] });
      toast.success('Document uploaded');
    },
    onError: (e) => Alert.alert('Upload failed', errorMessage(e, 'Could not upload the file.')),
  });

  const submitMutation = useMutation({
    mutationFn: () => {
      const signedAgreement = docsQuery.data?.find((d) => d.category === 'signed_agreement');
      if (!signedAgreement) throw new Error('Upload the signed agreement first.');
      return submitForCompliance({
        leadId,
        opportunityId,
        signedAgreementUrl: signedAgreement.filePath,
        clientSignature: clientSignature.trim() || undefined,
        signatureDate: signatureDate.toISOString().slice(0, 10),
        conversationSummary: conversationSummary.trim() || undefined,
      });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['opportunity-documents', opportunityId] });
      toast.success('Submitted for compliance review');
      navigation.navigate('LeadDetail', { leadId });
    },
    onError: (e) => setError(errorMessage(e, 'Unable to submit for compliance review.')),
  });

  const documentFor = (category: DocumentCategory) => docsQuery.data?.find((d) => d.category === category);
  const signedAgreement = documentFor('signed_agreement');
  const mandatoryUploaded = DOCUMENT_CATEGORIES.every((c) => documentFor(c.value));

  if (docsQuery.isPending) {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }

  return (
    <Screen scroll keyboardAvoiding refreshing={docsQuery.isRefetching} onRefresh={() => void docsQuery.refetch()}>
      <View style={{ gap: spacing.md }}>
        <Text tone="muted">Documents for {lead ? lead.fname || 'this opportunity' : 'this opportunity'}.</Text>

        <Card>
          <Text variant="heading" style={{ marginBottom: spacing.sm }}>
            Required documents
          </Text>
          <View style={{ gap: spacing.sm }}>
            {DOCUMENT_CATEGORIES.map((cat) => {
              const doc = documentFor(cat.value);
              return (
                <View key={cat.value} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text>{cat.label}</Text>
                    {doc ? <Badge label="Uploaded" tone="success" /> : null}
                  </View>
                  <Button
                    title={doc ? 'Replace' : 'Upload'}
                    size="sm"
                    variant={doc ? 'outline' : 'secondary'}
                    onPress={() => pickFile((file) => uploadMutation.mutate({ category: cat.value, file }))}
                    loading={uploadMutation.isPending && uploadMutation.variables?.category === cat.value}
                  />
                </View>
              );
            })}
          </View>
        </Card>

        <Card>
          <Text variant="heading" style={{ marginBottom: spacing.sm }}>
            Signed agreement
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text>Signed copy</Text>
              {signedAgreement ? <Badge label="Uploaded" tone="success" /> : null}
            </View>
            <Button
              title={signedAgreement ? 'Replace' : 'Upload'}
              size="sm"
              variant={signedAgreement ? 'outline' : 'secondary'}
              onPress={() => pickFile((file) => uploadMutation.mutate({ category: 'signed_agreement', file }))}
              loading={uploadMutation.isPending && uploadMutation.variables?.category === 'signed_agreement'}
            />
          </View>

          <View style={{ gap: spacing.md }}>
            <Input label="Client signature (name, optional)" value={clientSignature} onChangeText={setClientSignature} editable={!submitMutation.isPending} />
            <DateTimeField label="Signature date" value={signatureDate} onChange={setSignatureDate} mode="date" />
            <Input
              label="Conversation summary (optional)"
              value={conversationSummary}
              onChangeText={setConversationSummary}
              multiline
              editable={!submitMutation.isPending}
            />
            {error ? (
              <Text tone="danger" accessibilityRole="alert">
                {error}
              </Text>
            ) : null}
            <Button
              title="Submit for compliance review"
              onPress={() => void submitMutation.mutateAsync()}
              loading={submitMutation.isPending}
              disabled={!signedAgreement || !mandatoryUploaded}
              fullWidth
            />
            {!mandatoryUploaded ? (
              <Text variant="caption" tone="muted">
                Upload the 3 required documents above first.
              </Text>
            ) : null}
          </View>
        </Card>
      </View>
    </Screen>
  );
}
