import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { Sheet } from '@/components/AppUI';
import { code128Digits } from '@/lib/code128';
import { type EwbRecord } from '@/lib/domain';
import { ewbSheet, qrPath } from '@/lib/ewb-sheet';
import { useAppStore } from '@/state/app-store';

/**
 * The e-way bill as the NIC portal prints it (EWB-01), drawn from the same
 * model as the PDF so the preview and the printout match. Always black on
 * white, like the paper copy.
 */
export function EwbPreview({ ewb, visible, onClose, sandbox }: { ewb: EwbRecord; visible: boolean; onClose: () => void; sandbox: boolean }) {
  const invoice = useAppStore().invoices.find((item) => item.id === ewb.invoiceId);
  const sheet = useMemo(() => ewbSheet(ewb, invoice), [ewb, invoice]);
  const qr = useMemo(() => qrPath(sheet.qrText), [sheet.qrText]);
  const bars = useMemo(() => {
    try {
      return code128Digits(ewb.ewbNumber);
    } catch {
      return null;
    }
  }, [ewb.ewbNumber]);

  const row = ([label, value]: [string, string], big = false) => (
    <View style={styles.row} key={label}>
      <Text style={[styles.cell, styles.label]}>{label}</Text>
      <Text style={[styles.cell, styles.value, big && styles.big]} selectable>{value}</Text>
    </View>
  );
  const columns = ['Mode', 'Vehicle / Trans Doc No & Dt.', 'From', 'Entered Date', 'Entered By', 'CEWB No. (If any)', 'Multi Veh.Info (If any)'];
  const widths = [52, 110, 80, 120, 130, 80, 90];

  return (
    <Sheet visible={visible} onClose={onClose} title="E-way bill preview" subtitle={sandbox ? 'Test bill — not valid for transport' : 'As it prints'}>
      <View style={styles.paper}>
        {sheet.stamp || sandbox ? <Text style={styles.stamp} pointerEvents="none">{sheet.stamp ?? 'TEST BILL'}</Text> : null}
        <View style={styles.title}>
          <Text style={styles.titleText}>e-Way Bill</Text>
          <Svg width={112} height={112} viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`}>
            <Rect x={-2} y={-2} width={qr.size + 4} height={qr.size + 4} fill="#fff" />
            <Path d={qr.d} fill="#000" />
          </Svg>
        </View>
        {sheet.header.map((item, index) => row(item, index === 0))}
        <Text style={[styles.cell, styles.section]}>Part - A</Text>
        {sheet.partA.map((item) => row(item))}
        <Text style={[styles.cell, styles.section]}>Part - B</Text>
        <ScrollView horizontal style={styles.partB} contentContainerStyle={{ padding: 6 }}>
          <View style={styles.grid}>
            <View style={styles.tr}>{columns.map((title, index) => <Text key={title} style={[styles.td, styles.th, { width: widths[index] }]}>{title}</Text>)}</View>
            {sheet.partB.length ? sheet.partB.map((entry, rowIndex) => (
              <View style={styles.tr} key={rowIndex}>
                {[entry.mode, entry.vehicle, entry.from, entry.enteredDate, entry.enteredBy, entry.cewb, entry.multiVehicle].map((value, index) => <Text key={index} style={[styles.td, { width: widths[index] }]} selectable>{value}</Text>)}
              </View>
            )) : <View style={styles.tr}>{widths.map((width, index) => <Text key={index} style={[styles.td, { width }]}> </Text>)}</View>}
          </View>
        </ScrollView>
        {bars ? (
          <View style={styles.barcode}>
            <Svg width={Math.min(260, bars.reduce((a, b) => a + b, 0) * 1.6)} height={44} viewBox={`0 0 ${bars.reduce((a, b) => a + b, 0)} 44`} preserveAspectRatio="none">
              {(() => {
                let x = 0;
                return bars.map((width, index) => {
                  const bar = index % 2 === 0 ? <Rect key={index} x={x} y={0} width={width} height={44} fill="#000" /> : null;
                  x += width;
                  return bar;
                });
              })()}
            </Svg>
            <Text style={styles.digits}>{ewb.ewbNumber}</Text>
          </View>
        ) : null}
        <Text style={[styles.cell, styles.note]}>Note*: If any discrepancy in information please try after sometimes.</Text>
      </View>
    </Sheet>
  );
}

const line = '#999';
const styles = StyleSheet.create({
  paper: { marginHorizontal: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: line, overflow: 'hidden' },
  title: { alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderColor: line, gap: 4 },
  titleText: { fontSize: 18, fontWeight: '700', color: '#000' },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderColor: line },
  cell: { color: '#000', fontSize: 11.5, paddingHorizontal: 6, paddingVertical: 9 },
  label: { width: '37%', borderRightWidth: 1, borderColor: line },
  value: { flex: 1, fontWeight: '700' },
  big: { fontSize: 15 },
  section: { fontWeight: '700', borderBottomWidth: 1, borderColor: line },
  partB: { borderBottomWidth: 1, borderColor: line },
  tr: { flexDirection: 'row' },
  // Each cell draws its right and bottom edge; the grid draws the top and left, so every line is single.
  grid: { borderTopWidth: 1, borderLeftWidth: 1, borderColor: line },
  td: { borderRightWidth: 1, borderBottomWidth: 1, borderColor: line, paddingHorizontal: 5, paddingVertical: 7, fontSize: 10.5, color: '#000' },
  th: { fontWeight: '700' },
  barcode: { alignItems: 'center', paddingTop: 10, paddingBottom: 4, borderBottomWidth: 1, borderColor: line },
  digits: { fontSize: 10, color: '#000', marginTop: 2, letterSpacing: 1 },
  note: { fontSize: 9.5 },
  stamp: { position: 'absolute', top: '38%', left: 0, right: 0, textAlign: 'center', fontSize: 44, fontWeight: '800', color: 'rgba(190,30,30,0.18)', transform: [{ rotate: '-24deg' }], zIndex: 2 },
});
