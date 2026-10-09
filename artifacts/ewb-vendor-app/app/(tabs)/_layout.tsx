import React from 'react';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { SymbolView } from 'expo-symbols';
import { Redirect } from 'expo-router';
import { useAuth } from '@/state/auth';
import { useAppStore } from '@/state/app-store';
import { useColors } from '@/hooks/useColors';

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index"><NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" /><NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label></NativeTabs.Trigger>
      <NativeTabs.Trigger name="invoices"><NativeTabs.Trigger.Icon sf={{ default: 'doc.text', selected: 'doc.text.fill' }} md="description" /><NativeTabs.Trigger.Label>Invoices</NativeTabs.Trigger.Label></NativeTabs.Trigger>
      <NativeTabs.Trigger name="ewbs"><NativeTabs.Trigger.Icon sf={{ default: 'shippingbox', selected: 'shippingbox.fill' }} md="local_shipping" /><NativeTabs.Trigger.Label>E-way bills</NativeTabs.Trigger.Label></NativeTabs.Trigger>
      <NativeTabs.Trigger name="gst"><NativeTabs.Trigger.Icon sf={{ default: 'chart.bar', selected: 'chart.bar.fill' }} md="query_stats" /><NativeTabs.Trigger.Label>GST</NativeTabs.Trigger.Label></NativeTabs.Trigger>
      <NativeTabs.Trigger name="account"><NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="person" /><NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label></NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const isDark = useColorScheme() === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  const tabs = [
    { name: 'index', title: 'Home', icon: 'home' as const, symbol: 'house' },
    { name: 'invoices', title: 'Invoices', icon: 'file-text' as const, symbol: 'doc.text' },
    { name: 'ewbs', title: 'E-way bills', icon: 'truck' as const, symbol: 'shippingbox' },
    { name: 'gst', title: 'GST', icon: 'bar-chart-2' as const, symbol: 'chart.bar' },
    { name: 'account', title: 'Account', icon: 'user' as const, symbol: 'person.crop.circle' },
  ] as const;
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.mutedForeground,
      tabBarLabelStyle: { fontFamily: 'Inter_500Medium', fontSize: 10, marginBottom: Platform.OS === 'web' ? 10 : 3 },
      tabBarStyle: {
        position: 'absolute',
        height: isWeb ? 84 : 62,
        paddingTop: 7,
        paddingBottom: isWeb ? 34 : 7,
        backgroundColor: isIOS ? 'transparent' : colors.card,
        borderTopWidth: isWeb ? 1 : StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
        elevation: 0,
      },
      tabBarBackground: () => isIOS ? <BlurView intensity={90} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} /> : isWeb ? <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.card }]} /> : null,
    }}>
      {tabs.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{
          title: tab.title,
          tabBarIcon: ({ color }) => isIOS
            ? <SymbolView name={tab.symbol} tintColor={color} size={21} />
            : <Feather name={tab.icon} size={20} color={color} />,
        }} />
      ))}
    </Tabs>
  );
}

export default function TabLayout() {
  const { user, previewMode, isLoading } = useAuth();
  const store = useAppStore();
  if (isLoading || !store.isHydrated) return null;
  if (!previewMode && !user?.emailVerified) return <Redirect href="/" />;
  if (!store.business) return <Redirect href="/setup" />;
  return isLiquidGlassAvailable() ? <NativeTabLayout /> : <ClassicTabLayout />;
}
