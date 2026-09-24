import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { MIN_TOUCH } from '@/theme/tokens';
import { formatDateTime } from '@/utils/format';
import { Icon } from './ui/Icon';
import { Text } from './ui/Text';

interface DateTimeFieldProps {
  label: string;
  value: Date | null;
  onChange: (date: Date) => void;
  mode?: 'date' | 'datetime';
  minimumDate?: Date;
  error?: string | null;
}

/** Native date (or date + time) picker behind a tappable field. */
export function DateTimeField({ label, value, onChange, mode = 'datetime', minimumDate, error }: DateTimeFieldProps) {
  const { colors, radius, spacing } = useTheme();
  const [iosOpen, setIosOpen] = useState(false);

  const shown = value
    ? mode === 'date'
      ? value.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      : formatDateTime(value)
    : 'Select';

  const pick = () => {
    const current = value ?? new Date();
    if (Platform.OS === 'android') {
      // Android shows date then time as two native dialogs.
      DateTimePickerAndroid.open({
        value: current,
        mode: 'date',
        minimumDate,
        onValueChange: (_event: DateTimePickerChangeEvent, date: Date) => {
          if (mode === 'date') {
            onChange(date);
            return;
          }
          DateTimePickerAndroid.open({
            value: date,
            mode: 'time',
            is24Hour: true,
            onValueChange: (_e: DateTimePickerChangeEvent, time: Date) => onChange(time),
          });
        },
      });
    } else {
      setIosOpen((open) => !open);
    }
  };

  return (
    <View>
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown}`}
        onPress={pick}
        style={[
          styles.field,
          { backgroundColor: colors.input, borderColor: error ? colors.danger : colors.border, borderRadius: radius.md, minHeight: MIN_TOUCH + 4, paddingHorizontal: spacing.md },
        ]}
      >
        <Icon name={mode === 'date' ? 'calendar-outline' : 'time-outline'} size={18} color={colors.textMuted} />
        <Text style={{ marginLeft: 10, color: value ? colors.text : colors.placeholder }}>{shown}</Text>
      </Pressable>
      {error ? (
        <Text variant="caption" tone="danger" style={{ marginTop: spacing.xs }}>
          {error}
        </Text>
      ) : null}
      {Platform.OS === 'ios' && iosOpen ? (
        <DateTimePicker
          value={value ?? new Date()}
          mode={mode === 'date' ? 'date' : 'datetime'}
          display="inline"
          minimumDate={minimumDate}
          onValueChange={(_event: DateTimePickerChangeEvent, date: Date) => onChange(date)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 } });
