// mobile/src/components/auth/AuthChipGroup.tsx
// Segmented single-choice chips (foot, role) for the auth flow's white card.
// Same selection pattern as the app's dark-mode chips elsewhere, restyled
// for a light background.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, typography, spacing } from '@/theme';

const INK = '#122A1F';
const CHIP_BORDER = '#DADFDA';

interface AuthChipGroupProps<T extends string> {
  label: string;
  options: readonly T[];
  optionLabels: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
}

export function AuthChipGroup<T extends string>({ label, options, optionLabels, value, onChange }: AuthChipGroupProps<T>) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        {options.map((option) => {
          const selected = option === value;
          return (
            <Pressable key={option} style={[styles.chip, selected && styles.chipSelected]} onPress={() => onChange(option)}>
              <Text style={selected ? styles.chipTextSelected : styles.chipText}>{optionLabels[option]}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.spaceXs },
  label: { color: colors.background, ...typography.meta, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', gap: spacing.spaceXs },
  chip: { borderWidth: 1, borderColor: CHIP_BORDER, borderRadius: 999, paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceMd },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: INK, ...typography.body },
  chipTextSelected: { color: colors.onPrimary, ...typography.body },
});
