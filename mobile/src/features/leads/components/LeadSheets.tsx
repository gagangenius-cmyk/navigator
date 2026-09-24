import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Chip, DateTimeField, Input, Sheet, Text } from '@/components';
import { errorMessage } from '@/services/api/errors';
import { toast } from '@/store/uiStore';
import { useTheme } from '@/theme/ThemeProvider';
import { useAddRemark, useChangeStatus, useCreateFollowUp } from '../hooks';
import type { LeadStatusOption } from '../types';

interface BaseProps {
  visible: boolean;
  onClose: () => void;
  leadId: number;
}

export function StatusSheet({ visible, onClose, leadId, current, statuses }: BaseProps & { current: string | null; statuses: LeadStatusOption[] }) {
  const { spacing } = useTheme();
  const mutation = useChangeStatus(leadId);
  const [status, setStatus] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setStatus(null);
    setNotes('');
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!status) return;
    // The web app requires a reason with every status change; keep the same audit trail.
    if (notes.trim().length < 3) {
      setError('Add a short note explaining the change.');
      return;
    }
    setError(null);
    try {
      await mutation.mutateAsync({ status, notes: notes.trim() });
      toast.success(`Status changed to ${status}`);
      close();
    } catch (e) {
      setError(errorMessage(e, 'Unable to change the status.'));
    }
  };

  return (
    <Sheet visible={visible} onClose={close} title="Change status" dismissable={!mutation.isPending}>
      <View style={{ gap: spacing.md }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {statuses.map((s) => (
            <Chip key={s.id} label={s.name} selected={(status ?? current) === s.name} onPress={() => setStatus(s.name)} />
          ))}
        </ScrollView>
        <Input label="Why is the status changing?" value={notes} onChangeText={setNotes} multiline editable={!mutation.isPending} error={error} />
        <Button title="Update status" onPress={() => void submit()} loading={mutation.isPending} disabled={!status || status === current} fullWidth />
      </View>
    </Sheet>
  );
}

export function RemarkSheet({ visible, onClose, leadId }: BaseProps) {
  const { spacing } = useTheme();
  const mutation = useAddRemark(leadId);
  const [remark, setRemark] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setRemark('');
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (remark.trim().length < 2) {
      setError('Write a remark first.');
      return;
    }
    setError(null);
    try {
      await mutation.mutateAsync(remark);
      toast.success('Remark added');
      close();
    } catch (e) {
      setError(errorMessage(e, 'Unable to save the remark.'));
    }
  };

  return (
    <Sheet visible={visible} onClose={close} title="Add remark" dismissable={!mutation.isPending}>
      <View style={{ gap: spacing.md }}>
        <Input label="Remark" value={remark} onChangeText={setRemark} multiline autoFocus editable={!mutation.isPending} error={error} />
        <Button title="Save remark" onPress={() => void submit()} loading={mutation.isPending} fullWidth />
      </View>
    </Sheet>
  );
}

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

export function FollowUpSheet({ visible, onClose, leadId, employeeId }: BaseProps & { employeeId: number }) {
  const { spacing } = useTheme();
  const mutation = useCreateFollowUp();
  const [when, setWhen] = useState<Date | null>(null);
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setWhen(null);
    setMessage('');
    setPriority('medium');
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!when) {
      setError('Pick a date and time.');
      return;
    }
    if (when.getTime() < Date.now()) {
      setError('Choose a time in the future.');
      return;
    }
    if (message.trim().length < 2) {
      setError('Say what the follow-up is about.');
      return;
    }
    setError(null);
    try {
      await mutation.mutateAsync({ leadId, employeeId, scheduledAt: when.toISOString(), message, priority });
      toast.success('Follow-up scheduled');
      close();
    } catch (e) {
      setError(errorMessage(e, 'Unable to schedule the follow-up.'));
    }
  };

  return (
    <Sheet visible={visible} onClose={close} title="Schedule follow-up" dismissable={!mutation.isPending}>
      <View style={{ gap: spacing.md }}>
        <DateTimeField label="When" value={when} onChange={setWhen} minimumDate={new Date()} />
        <Input label="What is it about?" value={message} onChangeText={setMessage} editable={!mutation.isPending} />
        <View>
          <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
            Priority
          </Text>
          <View style={{ flexDirection: 'row' }}>
            {PRIORITIES.map((p) => (
              <Chip key={p.value} label={p.label} selected={priority === p.value} onPress={() => setPriority(p.value)} />
            ))}
          </View>
        </View>
        {error ? (
          <Text variant="caption" tone="danger">
            {error}
          </Text>
        ) : null}
        <Button title="Schedule" onPress={() => void submit()} loading={mutation.isPending} fullWidth />
      </View>
    </Sheet>
  );
}
