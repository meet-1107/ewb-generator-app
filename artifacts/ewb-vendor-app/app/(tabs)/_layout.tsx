import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Redirect, Tabs } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/state/auth';
import { useAppStore } from '@/state/app-store';
import { useColors } from '@/hooks/useColors';

const tabs = [
  { name: 'index', title: 'Dashboard', icon: 'home' as const, symbol: 'house', md: 'home' },
  { name: 'invoices', title: 'Invoices', icon: 'file-text' as const, symbol: 'doc.text', md: 'description' },
  { name: 'ewbs', title: 'E-way bills', icon: 'truck' as const, symbol: 'shippingbox', md: 'local_shipping' },
  { name: 'buyers', title: 'Buyers', icon: 'users' as const, symbol: 'person.2', md: 'group' },
  { name: 'products', title: 'Products', icon: 'package' as const, symbol: 'cube.box', md: 'inventory_2' },
] as const;

function NativeTabLayout() {
  return (
    <NativeTabs>
      {tabs.map((tab) => (
        <NativeTabs.Trigger key={tab.name} name={tab.name}>
          <NativeTabs.Trigger.Icon sf={{ default: tab.symbol, selected: `${tab.symbol}.fill` } as never} md={tab.md as never} />
          <NativeTabs.Trigger.Label>{tab.title}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  const bottom = isWeb ? 10 : Math.max(insets.bottom, 8);
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.mutedForeground,
      tabBarLabelStyle: { fontFamily: 'Inter_600SemiBold', fontSize: 10.5, marginTop: 1 },
      tabBarItemStyle: { paddingTop: 4 },
      tabBarStyle: {
        position: 'absolute',
        height: 58 + bottom,
        paddingBottom: bottom,
        backgroundColor: isIOS ? 'transparent' : colors.card,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
        elevation: 0,
      },
      tabBarBackground: () => isIOS
        ? <BlurView intensity={90} tint={colors.isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        : <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.card }]} />,
    }}>
      {tabs.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{
          title: tab.title,
          tabBarAccessibilityLabel: tab.title,
          tabBarIcon: ({ color, focused }) => isIOS
            ? <SymbolView name={(focused ? `${tab.symbol}.fill` : tab.symbol) as never} tintColor={color} size={22} />
            : <Feather name={tab.icon} size={21} color={color} />,
        }} />
      ))}
    </Tabs>
  );
}

export default function TabLayout() {
  const { signedIn, isLoading } = useAuth();
  const store = useAppStore();
  if (isLoading || !store.isHydrated) return null;
  if (!signedIn) return <Redirect href="/sign-in" />;
  if (!store.business) return <Redirect href="/setup" />;
  return isLiquidGlassAvailable() ? <NativeTabLayout /> : <ClassicTabLayout />;
}
