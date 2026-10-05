import 'react-native-gesture-handler';

import React, { useEffect, useState } from 'react';
import { AppState, ActivityIndicator, View, Image } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import HomeScreen from './src/screens/HomeScreen';
import WalletScreen from './src/screens/WalletScreen';
import WalletDetailScreen from './src/screens/WalletDetailScreen';
import AddWalletScreen from './src/screens/AddWalletScreen';
import BillsScreen from './src/screens/BillsScreen';
import AddPayableScreen from './src/screens/AddPayableScreen';
import AIScreen from './src/screens/AIScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import ProfileOnboardingScreen from './src/screens/ProfileOnboardingScreen';
import AppTourScreen from './src/screens/AppTourScreen';
import LaunchScreen from './src/screens/LaunchScreen';

import { getData } from './src/utils/storage';
import { isOnboardingComplete } from './src/utils/profile';
import { applyDueIncomes } from './src/utils/income';
import { rescheduleAllBills, runDailyBudgetSweep } from './src/utils/notifications';
import { navTheme, palette } from './src/theme/design';

const RootStack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const WalletStack = createNativeStackNavigator();
const BillsStack = createNativeStackNavigator();

const stackOptions = {
  headerStyle: { backgroundColor: palette.bg },
  headerTintColor: palette.text,
  headerShadowVisible: false,
  headerTitleStyle: { fontWeight: '800', color: palette.text },
  contentStyle: { backgroundColor: palette.bg },
};

function WalletStackScreen() {
  return (
    <WalletStack.Navigator screenOptions={stackOptions}>
      <WalletStack.Screen name="WalletList" component={WalletScreen} options={{ title: 'Wallets' }} />
      <WalletStack.Screen name="AddWallet" component={AddWalletScreen} options={{ title: 'New Wallet' }} />
      <WalletStack.Screen name="WalletDetail" component={WalletDetailScreen} options={{ title: 'Wallet Details' }} />
    </WalletStack.Navigator>
  );
}

function BillsStackScreen() {
  return (
    <BillsStack.Navigator screenOptions={stackOptions}>
      <BillsStack.Screen name="BillsHome" component={BillsScreen} options={{ title: 'Bills & Subscriptions' }} />
      <BillsStack.Screen name="AddPayable" component={AddPayableScreen} options={{ headerShown: false }} />
      <BillsStack.Screen name="AddBill" component={AddPayableScreen} options={{ headerShown: false }} />
    </BillsStack.Navigator>
  );
}

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: palette.bg },
        headerTintColor: palette.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '800', color: palette.text },
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.muted,
        tabBarLabelStyle: {
          fontSize: 10.5,
          fontWeight: '700',
          marginBottom: 7,
        },
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          height: 72,
          paddingTop: 8,
          backgroundColor: palette.surface,
          borderTopColor: palette.hairline,
          borderTopWidth: 1,
        },
        tabBarIcon: ({ color, size, focused }) => {
          const iconSize = focused ? size + 1 : size;
          switch (route.name) {
            case 'Home':
              return <Ionicons name={focused ? 'home' : 'home-outline'} size={iconSize} color={color} />;
            case 'Wallet':
              return <Ionicons name={focused ? 'wallet' : 'wallet-outline'} size={iconSize} color={color} />;
            case 'Bills':
              return <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={iconSize} color={color} />;
            case 'AI':
              return (
                <Image
                  source={require('./assets/branding/pengpeng-avatar.png')}
                  style={{
                    width: iconSize + 1,
                    height: iconSize + 1,
                    borderRadius: (iconSize + 1) / 2,
                    opacity: focused ? 1 : 0.72,
                  }}
                  resizeMode="cover"
                />
              );
            case 'Profile':
              return <Ionicons name={focused ? 'person' : 'person-outline'} size={iconSize} color={color} />;
            default:
              return <Ionicons name="ellipse-outline" size={iconSize} color={color} />;
          }
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Overview' }} />
      <Tab.Screen name="Wallet" component={WalletStackScreen} options={{ headerShown: false, title: 'Wallets' }} />
      <Tab.Screen name="Bills" component={BillsStackScreen} options={{ headerShown: false }} />
      <Tab.Screen
        name="AI"
        component={AIScreen}
        options={{
          title: 'Pengpeng AI',
          headerTitle: 'Pengpeng AI',
          tabBarLabel: 'Pengpeng',
        }}
      />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [initialRoute, setInitialRoute] = useState(null);
  const [showBrandSplash, setShowBrandSplash] = useState(true);


  useEffect(() => {
    (async () => {
      // First-install flow:
      // Splash -> App Tour -> Profile Onboarding -> Home.
      //
      // Normal opens after setup:
      // Splash -> Home.
      //
      // If the user closes the app before finishing Profile Onboarding,
      // the next open resumes onboarding instead of skipping required setup.
      const seenFirstRunTour = Boolean(
        await getData('pengpeng_first_run_tour_seen_v1')
      );
      const onboarded = await isOnboardingComplete();

      setInitialRoute(
        !seenFirstRunTour
          ? 'AppTour'
          : !onboarded
            ? 'ProfileOnboarding'
            : 'Tabs'
      );

      await Promise.allSettled([
        applyDueIncomes(),
        rescheduleAllBills(),
        runDailyBudgetSweep(),
      ]);
    })();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'active') {
        await Promise.allSettled([
          applyDueIncomes(),
          rescheduleAllBills(),
          runDailyBudgetSweep(),
        ]);
      }
    });
    return () => sub.remove();
  }, []);

  if (showBrandSplash) {
    return <LaunchScreen onContinue={() => setShowBrandSplash(false)} />;
  }

  if (!initialRoute) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={palette.primary} size="large" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.bg }}>
      <NavigationContainer theme={navTheme}>
        <RootStack.Navigator initialRouteName={initialRoute} screenOptions={stackOptions}>
          <RootStack.Screen name="AppTour" component={AppTourScreen} options={{ headerShown: false }} />
          <RootStack.Screen
            name="ProfileOnboarding"
            component={ProfileOnboardingScreen}
            options={{ title: 'Set up your finances' }}
          />
          <RootStack.Screen
            name="Onboarding"
            component={ProfileOnboardingScreen}
            options={{ title: 'Set up your finances' }}
          />
          <RootStack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        </RootStack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}
