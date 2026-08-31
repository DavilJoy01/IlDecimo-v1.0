import { View, Text, StyleSheet } from 'react-native';

export function ScreenPlaceholder({ title }: { title: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>{title}</Text>
      <Text style={styles.subtext}>In arrivo in un prossimo aggiornamento.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  text: { fontSize: 18, fontWeight: '600' },
  subtext: { color: '#666' },
});
