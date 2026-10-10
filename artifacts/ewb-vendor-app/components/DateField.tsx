import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Sheet, TextBlock } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';
import { formatDate, today } from '@/lib/domain';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const pad = (value: number) => String(value).padStart(2, '0');
const iso = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;

/** A date field that opens a month calendar. `value` and `max` are YYYY-MM-DD. */
export function DateField({ label, value, onChange, error, required, max = today(), testID }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  max?: string;
  testID?: string;
}) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today();
  const [month, setMonth] = useState({ year: Number(start.slice(0, 4)), month: Number(start.slice(5, 7)) - 1 });

  const show = () => {
    setMonth({ year: Number(start.slice(0, 4)), month: Number(start.slice(5, 7)) - 1 });
    setOpen(true);
  };
  const shift = (by: number) => setMonth((current) => {
    const date = new Date(Date.UTC(current.year, current.month + by, 1));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
  });

  const first = new Date(Date.UTC(month.year, month.month, 1)).getUTCDay();
  const days = new Date(Date.UTC(month.year, month.month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array<null>(first).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)];
  const title = new Date(Date.UTC(month.year, month.month, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const next = new Date(Date.UTC(month.year, month.month + 1, 1));
  const canGoNext = iso(next.getUTCFullYear(), next.getUTCMonth(), 1) <= max;

  return (
    <View style={{ gap: 7 }}>
      <TextBlock size={13} weight="semibold">{label}{required ? <TextBlock size={13} weight="semibold" color={colors.destructive}> *</TextBlock> : null}</TextBlock>
      <Pressable
        onPress={show}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ? formatDate(value) : 'not set'}. Opens a calendar`}
        testID={testID}
        style={({ pressed }) => [styles.field, { borderColor: error ? colors.destructive : colors.input, backgroundColor: colors.card, opacity: pressed ? 0.85 : 1 }]}
      >
        <TextBlock size={15} color={value ? undefined : colors.mutedForeground}>{value ? formatDate(value) : 'Choose date'}</TextBlock>
        <Feather name="calendar" size={17} color={colors.mutedForeground} />
      </Pressable>
      {error ? <TextBlock size={12} color={colors.destructive}>{error}</TextBlock> : null}

      <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
        <View style={{ paddingHorizontal: 18, gap: 12, paddingBottom: 8 }}>
          <View style={styles.monthRow}>
            <Pressable onPress={() => shift(-1)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Previous month" style={styles.arrow}><Feather name="chevron-left" size={22} color={colors.foreground} /></Pressable>
            <TextBlock size={16} weight="bold">{title}</TextBlock>
            <Pressable onPress={() => canGoNext && shift(1)} disabled={!canGoNext} hitSlop={10} accessibilityRole="button" accessibilityLabel="Next month" style={[styles.arrow, { opacity: canGoNext ? 1 : 0.3 }]}><Feather name="chevron-right" size={22} color={colors.foreground} /></Pressable>
          </View>
          <View style={styles.grid}>
            {WEEKDAYS.map((day, index) => <View key={`w${index}`} style={styles.cell}><TextBlock size={12} weight="semibold" color={colors.mutedForeground}>{day}</TextBlock></View>)}
            {cells.map((day, index) => {
              if (!day) return <View key={`e${index}`} style={styles.cell} />;
              const date = iso(month.year, month.month, day);
              const selected = date === value;
              const disabled = date > max;
              const isToday = date === today();
              return (
                <Pressable
                  key={date}
                  disabled={disabled}
                  onPress={() => { onChange(date); setOpen(false); }}
                  accessibilityRole="button"
                  accessibilityLabel={formatDate(date)}
                  accessibilityState={{ selected, disabled }}
                  style={styles.cell}
                >
                  <View style={[styles.day, selected && { backgroundColor: colors.primary }, !selected && isToday && { borderWidth: 1, borderColor: colors.primary }]}>
                    <TextBlock size={14} weight={selected || isToday ? 'bold' : 'regular'} color={selected ? colors.primaryForeground : disabled ? colors.border : undefined}>{day}</TextBlock>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={() => { onChange(today()); setOpen(false); }} accessibilityRole="button" style={styles.todayButton}>
            <TextBlock size={14} weight="semibold" color={colors.primary}>Today</TextBlock>
          </Pressable>
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { minHeight: 52, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  day: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  todayButton: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 16 },
});
