// src/screens/ProfileOnboardingScreen.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Switch,
  Platform,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { getData, saveData } from '../utils/storage';
import { setRecurringIncomes } from '../utils/income';
import {
  ensurePaydayReminders,
  cancelPaydayReminders,
} from '../utils/notifications';
import {
  palette,
  gradients,
  radius,
  spacing,
  shadow,
} from '../theme/design';

const peso = (n) =>
  `₱${Number(n || 0).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}`;

const HABIT_CATEGORIES = [
  'Food & Drink',
  'Transport',
  'Shopping',
  'Bills & Utilities',
  'Groceries',
  'Entertainment',
  'Health & Fitness',
  'Subscriptions',
  'Education',
  'Gifts & Donations',
];

const STEPS = [
  {
    id: 0,
    label: 'Profile',
    icon: 'person-outline',
  },
  {
    id: 1,
    label: 'Income',
    icon: 'wallet-outline',
  },
  {
    id: 2,
    label: 'Habits',
    icon: 'analytics-outline',
  },
];

export default function ProfileOnboardingScreen() {
  const navigation = useNavigation();
  const route = useRoute();

  const mode =
    route.params?.mode === 'edit' ? 'edit' : 'new';

  const [step, setStep] = useState(0);

  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [incomeType, setIncomeType] =
    useState('salary');
  const [monthlyIncome, setMonthlyIncome] =
    useState('');

  const [autoAdd, setAutoAdd] = useState(false);
  const [twoPaydays, setTwoPaydays] =
    useState(false);

  const [paydayDate1, setPaydayDate1] = useState(
    () => new Date()
  );
  const [paydayDate2, setPaydayDate2] = useState(
    () => new Date()
  );
  const [showPicker1, setShowPicker1] =
    useState(false);
  const [showPicker2, setShowPicker2] =
    useState(false);

  const [selectedHabits, setSelectedHabits] =
    useState([]);
  const [exceedBudget, setExceedBudget] =
    useState('no');
  const [spendDriver, setSpendDriver] =
    useState('needs');

  const [lowBalPct, setLowBalPct] = useState('');

  useEffect(() => {
    (async () => {
      const p =
        (await getData('user_profile')) || {};

      if (mode !== 'edit') return;

      setName(p.name || '');
      setAge(String(p.age ?? ''));
      setIncomeType(p.incomeType || 'salary');
      setMonthlyIncome(
        String(p.monthlyIncome ?? '')
      );

      setAutoAdd(!!p.autoIncome?.enabled);

      const days = Array.isArray(
        p.autoIncome?.days
      )
        ? p.autoIncome.days
        : p.autoIncome?.dayOfMonth
          ? [p.autoIncome.dayOfMonth]
          : [];

      setTwoPaydays((days?.length || 0) > 1);

      const now = new Date();
      const clamp = (d) =>
        Math.min(
          28,
          Math.max(1, Number(d || 1))
        );

      const d1 = clamp(days?.[0] ?? 1);
      const d2 = clamp(days?.[1] ?? 15);

      setPaydayDate1(
        new Date(
          now.getFullYear(),
          now.getMonth(),
          d1
        )
      );

      setPaydayDate2(
        new Date(
          now.getFullYear(),
          now.getMonth(),
          d2
        )
      );

      const h = p.habits || {};
      const tops = Array.isArray(h.top3)
        ? h.top3.filter(Boolean)
        : [];

      setSelectedHabits(tops);
      setExceedBudget(
        h.exceedBudget || 'no'
      );
      setSpendDriver(
        h.spendDriver || 'needs'
      );

      setLowBalPct(
        p.alerts &&
          typeof p.alerts.lowBalancePct !==
            'undefined'
          ? String(p.alerts.lowBalancePct)
          : ''
      );
    })();
  }, [mode]);

  const fmtPayday = (d) =>
    d instanceof Date
      ? `Every month on day ${d.getDate()}`
      : '';

  const incomePreview = useMemo(
    () => Number(monthlyIncome || 0),
    [monthlyIncome]
  );

  const alertPreview = useMemo(() => {
    const income = Number(monthlyIncome || 0);
    const pct = Number(lowBalPct || 0);

    if (!(income > 0) || !(pct > 0)) return 0;

    return (pct / 100) * income;
  }, [monthlyIncome, lowBalPct]);

  const Chip = ({
    active,
    label,
    onPress,
    icon,
  }) => (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.84}
      style={[
        styles.chip,
        active && styles.chipActive,
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={14}
          color={
            active
              ? palette.cyan
              : palette.sub
          }
        />
      ) : null}

      <Text
        style={[
          styles.chipText,
          active && styles.chipTextActive,
          icon && { marginLeft: 6 },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  const toggleHabit = (cat) => {
    setSelectedHabits((prev) =>
      prev.includes(cat)
        ? prev.filter((h) => h !== cat)
        : [...prev, cat]
    );
  };

  const validateStep = (currentStep) => {
    if (currentStep === 0) {
      if (!name.trim()) {
        Alert.alert(
          'Missing name',
          'Please enter your name.'
        );
        return false;
      }

      if (
        !/^[A-Za-z\s]+$/.test(name.trim())
      ) {
        Alert.alert(
          'Invalid name',
          'Name should only contain letters and spaces.'
        );
        return false;
      }

      const ageNum = Number(age);

      if (
        !Number.isInteger(ageNum) ||
        ageNum <= 0 ||
        ageNum > 120
      ) {
        Alert.alert(
          'Invalid age',
          'Please enter a realistic age between 1 and 120.'
        );
        return false;
      }
    }

    if (currentStep === 1) {
      const income = Number(monthlyIncome);

      if (
        !Number.isFinite(income) ||
        income <= 0
      ) {
        Alert.alert(
          'Invalid income',
          'Monthly income must be greater than 0.'
        );
        return false;
      }

      if (
        !incomeType ||
        !['salary', 'allowance'].includes(
          incomeType
        )
      ) {
        Alert.alert(
          'Choose income type',
          'Please select Salary or Allowance.'
        );
        return false;
      }

      if (autoAdd) {
        if (
          !(
            paydayDate1 instanceof Date
          ) ||
          Number.isNaN(
            paydayDate1.getTime()
          )
        ) {
          Alert.alert(
            'Pick payday',
            'Please choose your payday.'
          );
          return false;
        }

        if (
          twoPaydays &&
          (!(
            paydayDate2 instanceof Date
          ) ||
            Number.isNaN(
              paydayDate2.getTime()
            ))
        ) {
          Alert.alert(
            'Pick second payday',
            'Please choose your second payday.'
          );
          return false;
        }
      }
    }

    if (currentStep === 2) {
      if (!selectedHabits.length) {
        Alert.alert(
          'Pick a spending category',
          'Select at least one spending category.'
        );
        return false;
      }

      const lb = Number(lowBalPct);

      if (
        !Number.isFinite(lb) ||
        lb < 1 ||
        lb > 100
      ) {
        Alert.alert(
          'Invalid percentage',
          'Low-balance alert must be between 1 and 100%.'
        );
        return false;
      }
    }

    return true;
  };

  const nextStep = () => {
    if (!validateStep(step)) return;
    setStep((current) =>
      Math.min(
        current + 1,
        STEPS.length - 1
      )
    );
  };

  const previousStep = () => {
    setStep((current) =>
      Math.max(current - 1, 0)
    );
  };

  const save = async () => {
    if (!validateStep(0)) {
      setStep(0);
      return;
    }

    if (!validateStep(1)) {
      setStep(1);
      return;
    }

    if (!validateStep(2)) {
      setStep(2);
      return;
    }

    const income =
      Number(monthlyIncome || 0) || 0;

    const day1 =
      paydayDate1?.getDate?.() || 1;
    const day2 =
      paydayDate2?.getDate?.() || 15;

    const days = autoAdd
      ? twoPaydays
        ? [day1, day2]
        : [day1]
      : [];

    const lb = Math.round(
      Number(lowBalPct)
    );

    const profilePatch = {
      name: name.trim(),
      age: Number(age || 0) || null,
      incomeType,
      monthlyIncome: income,
      habits: {
        top3: selectedHabits,
        exceedBudget,
        spendDriver,
      },
      alerts: {
        lowBalancePct: lb,
      },
      autoIncome: {
        enabled: autoAdd,
        days,
        type: incomeType,
        amount: income,
      },
      onboardingComplete: true,
    };

    const prev =
      (await getData('user_profile')) || {};

    await saveData('user_profile', {
      ...prev,
      ...profilePatch,
    });

    if (
      autoAdd &&
      income > 0 &&
      days.length
    ) {
      await setRecurringIncomes({
        type: incomeType,
        amount: income,
        days,
        enabled: true,
      });

      await ensurePaydayReminders(days);
    } else {
      await setRecurringIncomes({
        enabled: false,
        days: [],
      });

      await cancelPaydayReminders();
    }

    if (mode === 'edit') {
      Alert.alert(
        'Saved',
        'Your profile was updated.'
      );
      navigation.goBack();
    } else {
      navigation.reset({
        index: 0,
        routes: [{ name: 'Tabs' }],
      });
    }
  };

  const StepHeader = () => (
    <View style={styles.stepper}>
      {STEPS.map((item, index) => {
        const active = index === step;
        const complete = index < step;

        return (
          <React.Fragment key={item.id}>
            <View style={styles.stepItem}>
              <View
                style={[
                  styles.stepDot,
                  active &&
                    styles.stepDotActive,
                  complete &&
                    styles.stepDotComplete,
                ]}
              >
                <Ionicons
                  name={
                    complete
                      ? 'checkmark'
                      : item.icon
                  }
                  size={15}
                  color={
                    active || complete
                      ? '#fff'
                      : palette.muted
                  }
                />
              </View>

              <Text
                style={[
                  styles.stepText,
                  active &&
                    styles.stepTextActive,
                ]}
              >
                {item.label}
              </Text>
            </View>

            {index !== STEPS.length - 1 ? (
              <View
                style={[
                  styles.stepLine,
                  index < step &&
                    styles.stepLineComplete,
                ]}
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </View>
  );

  const renderProfileStep = () => (
    <>
      <Text style={styles.sectionEyebrow}>
        STEP 1 OF 3
      </Text>

      <Text style={styles.sectionTitle}>
        Personalize your tracker.
      </Text>

      <Text style={styles.sectionSubtitle}>
        A few basics help personalize the dashboard
        without making setup feel complicated.
      </Text>

      <View style={styles.field}>
        <Text style={styles.label}>Name</Text>

        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor={palette.muted}
          selectionColor={palette.cyan}
          autoCapitalize="words"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Age</Text>

        <TextInput
          style={styles.input}
          value={age}
          onChangeText={(text) =>
            setAge(
              text.replace(/[^0-9]/g, '')
            )
          }
          keyboardType="numeric"
          placeholder="e.g. 24"
          placeholderTextColor={palette.muted}
          selectionColor={palette.cyan}
        />
      </View>

      <View style={styles.profileNote}>
        <View style={styles.noteIcon}>
          <Ionicons
            name="shield-checkmark-outline"
            size={18}
            color={palette.cyan}
          />
        </View>

        <Text style={styles.profileNoteText}>
          Your profile stays part of your app data
          and is used to personalize budgeting and
          financial insights.
        </Text>
      </View>
    </>
  );

  const renderIncomeStep = () => (
    <>
      <Text style={styles.sectionEyebrow}>
        STEP 2 OF 3
      </Text>

      <Text style={styles.sectionTitle}>
        Set your income rhythm.
      </Text>

      <Text style={styles.sectionSubtitle}>
        This powers balance alerts and payday
        automation.
      </Text>

      <Text style={styles.label}>
        Main source of funds
      </Text>

      <View style={styles.chipRow}>
        <Chip
          active={incomeType === 'salary'}
          label="Salary"
          icon="briefcase-outline"
          onPress={() =>
            setIncomeType('salary')
          }
        />

        <Chip
          active={
            incomeType === 'allowance'
          }
          label="Allowance"
          icon="cash-outline"
          onPress={() =>
            setIncomeType('allowance')
          }
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>
          Monthly{' '}
          {incomeType === 'salary'
            ? 'salary'
            : 'allowance'}
        </Text>

        <View style={styles.amountRow}>
          <Text style={styles.currencyPrefix}>
            ₱
          </Text>

          <TextInput
            value={monthlyIncome}
            onChangeText={setMonthlyIncome}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={palette.muted}
            style={styles.amountInput}
            selectionColor={palette.cyan}
          />
        </View>
      </View>

      {incomePreview > 0 ? (
        <LinearGradient
          colors={[
            '#0D2B56',
            '#123D7C',
            '#155AA8',
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.incomePreview}
        >
          <View>
            <Text style={styles.previewLabel}>
              MONTHLY INCOME
            </Text>

            <Text style={styles.previewValue}>
              {peso(incomePreview)}
            </Text>
          </View>

          <Ionicons
            name="trending-up-outline"
            size={24}
            color="#D8EAFF"
          />
        </LinearGradient>
      ) : null}

      <View style={styles.toggleRow}>
        <View style={styles.toggleCopy}>
          <Text style={styles.toggleTitle}>
            Automatic payday income
          </Text>

          <Text style={styles.toggleDescription}>
            Adds your income to Total Balance on
            payday. Auto Split is configured
            separately in Wallets.
          </Text>
        </View>

        <Switch
          value={autoAdd}
          onValueChange={setAutoAdd}
          trackColor={{
            false: palette.surface3,
            true: palette.primary,
          }}
          thumbColor="#fff"
        />
      </View>

      {autoAdd ? (
        <View style={styles.autoIncomeSection}>
          <View style={styles.toggleRowCompact}>
            <Text style={styles.toggleTitle}>
              Two paydays per month
            </Text>

            <Switch
              value={twoPaydays}
              onValueChange={setTwoPaydays}
              trackColor={{
                false: palette.surface3,
                true: palette.primary,
              }}
              thumbColor="#fff"
            />
          </View>

          <Text style={styles.label}>
            Payday {twoPaydays ? '1' : ''}
          </Text>

          <TouchableOpacity
            onPress={() =>
              setShowPicker1(true)
            }
            style={styles.dateRow}
            activeOpacity={0.84}
          >
            <View style={styles.dateIcon}>
              <Ionicons
                name="calendar-outline"
                size={18}
                color={palette.cyan}
              />
            </View>

            <Text style={styles.dateText}>
              {fmtPayday(paydayDate1)}
            </Text>

            <Ionicons
              name="chevron-forward"
              size={17}
              color={palette.muted}
            />
          </TouchableOpacity>

          {showPicker1 ? (
            <View style={styles.pickerSurface}>
              <DateTimePicker
                value={paydayDate1}
                mode="date"
                display={
                  Platform.OS === 'ios'
                    ? 'inline'
                    : 'calendar'
                }
                themeVariant="dark"
                onChange={(e, sel) => {
                  if (
                    Platform.OS !== 'ios'
                  ) {
                    setShowPicker1(false);
                  }

                  if (sel) setPaydayDate1(sel);
                }}
              />

              {Platform.OS === 'ios' ? (
                <TouchableOpacity
                  onPress={() =>
                    setShowPicker1(false)
                  }
                  style={styles.pickerDone}
                >
                  <Text
                    style={
                      styles.pickerDoneText
                    }
                  >
                    Done
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {twoPaydays ? (
            <>
              <Text style={styles.label}>
                Payday 2
              </Text>

              <TouchableOpacity
                onPress={() =>
                  setShowPicker2(true)
                }
                style={styles.dateRow}
                activeOpacity={0.84}
              >
                <View style={styles.dateIcon}>
                  <Ionicons
                    name="calendar-outline"
                    size={18}
                    color={palette.cyan}
                  />
                </View>

                <Text style={styles.dateText}>
                  {fmtPayday(paydayDate2)}
                </Text>

                <Ionicons
                  name="chevron-forward"
                  size={17}
                  color={palette.muted}
                />
              </TouchableOpacity>

              {showPicker2 ? (
                <View
                  style={styles.pickerSurface}
                >
                  <DateTimePicker
                    value={paydayDate2}
                    mode="date"
                    display={
                      Platform.OS === 'ios'
                        ? 'inline'
                        : 'calendar'
                    }
                    themeVariant="dark"
                    onChange={(e, sel) => {
                      if (
                        Platform.OS !== 'ios'
                      ) {
                        setShowPicker2(false);
                      }

                      if (sel)
                        setPaydayDate2(sel);
                    }}
                  />

                  {Platform.OS === 'ios' ? (
                    <TouchableOpacity
                      onPress={() =>
                        setShowPicker2(false)
                      }
                      style={
                        styles.pickerDone
                      }
                    >
                      <Text
                        style={
                          styles.pickerDoneText
                        }
                      >
                        Done
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}
    </>
  );

  const renderHabitsStep = () => (
    <>
      <Text style={styles.sectionEyebrow}>
        STEP 3 OF 3
      </Text>

      <Text style={styles.sectionTitle}>
        Personalize your guidance.
      </Text>

      <Text style={styles.sectionSubtitle}>
        Pengpeng uses these preferences to make
        budget warnings and insights more relevant.
      </Text>

      <Text style={styles.label}>
        Common spending categories
      </Text>

      <Text style={styles.helper}>
        Pick at least one.
      </Text>

      <View style={styles.chipRow}>
        {HABIT_CATEGORIES.map((cat) => (
          <Chip
            key={cat}
            active={selectedHabits.includes(
              cat
            )}
            label={cat}
            onPress={() => toggleHabit(cat)}
          />
        ))}
      </View>

      <Text style={styles.label}>
        Do you often exceed your budget?
      </Text>

      <View style={styles.chipRow}>
        {[
          ['no', 'No'],
          ['sometimes', 'Sometimes'],
          ['yes', 'Yes'],
        ].map(([value, label]) => (
          <Chip
            key={value}
            active={
              exceedBudget === value
            }
            label={label}
            onPress={() =>
              setExceedBudget(value)
            }
          />
        ))}
      </View>

      <Text style={styles.label}>
        Most spending comes from
      </Text>

      <View style={styles.chipRow}>
        {[
          ['needs', 'Needs'],
          ['wants', 'Wants'],
          ['impulse', 'Impulse'],
          ['mix', 'A mix'],
        ].map(([value, label]) => (
          <Chip
            key={value}
            active={
              spendDriver === value
            }
            label={label}
            onPress={() =>
              setSpendDriver(value)
            }
          />
        ))}
      </View>

      <View style={styles.alertSection}>
        <View style={styles.alertHeading}>
          <View style={styles.alertIcon}>
            <Ionicons
              name="notifications-outline"
              size={18}
              color={palette.cyan}
            />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={styles.alertTitle}>
              Low-balance alert
            </Text>

            <Text
              style={
                styles.alertDescription
              }
            >
              Choose what percentage of monthly
              income should trigger a warning.
            </Text>
          </View>
        </View>

        <View style={styles.percentRow}>
          <TextInput
            style={styles.percentInput}
            value={lowBalPct}
            onChangeText={(text) =>
              setLowBalPct(
                text.replace(/[^0-9]/g, '')
              )
            }
            keyboardType="numeric"
            placeholder="20"
            placeholderTextColor={palette.muted}
            selectionColor={palette.cyan}
            maxLength={3}
          />

          <Text style={styles.percentSymbol}>
            %
          </Text>
        </View>

        {alertPreview > 0 ? (
          <Text style={styles.alertPreview}>
            You’ll be warned when Total Balance
            falls below approximately{' '}
            {peso(alertPreview)}.
          </Text>
        ) : null}
      </View>
    </>
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={
          styles.content
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topBrand}>
          <View>
            <Text style={styles.brandEyebrow}>
              PENGPENG
            </Text>

            <Text style={styles.brandTitle}>
              {mode === 'edit'
                ? 'Financial profile'
                : 'Personalize your tracker'}
            </Text>
          </View>

          <View style={styles.brandOrb}>
            <Ionicons
              name="sparkles"
              size={21}
              color={palette.cyan}
            />
          </View>
        </View>

        <StepHeader />

        <View style={styles.stepContent}>
          {step === 0
            ? renderProfileStep()
            : null}

          {step === 1
            ? renderIncomeStep()
            : null}

          {step === 2
            ? renderHabitsStep()
            : null}
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        {step > 0 ? (
          <TouchableOpacity
            onPress={previousStep}
            style={styles.backButton}
            activeOpacity={0.84}
          >
            <Ionicons
              name="arrow-back"
              size={17}
              color={palette.textSoft}
            />

            <Text style={styles.backText}>
              Back
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.backPlaceholder} />
        )}

        {step < STEPS.length - 1 ? (
          <TouchableOpacity
            onPress={nextStep}
            activeOpacity={0.9}
            style={styles.nextWrap}
          >
            <LinearGradient
              colors={gradients.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.nextButton}
            >
              <Text style={styles.nextText}>
                Continue
              </Text>

              <Ionicons
                name="arrow-forward"
                size={17}
                color="#fff"
              />
            </LinearGradient>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={save}
            activeOpacity={0.9}
            style={styles.nextWrap}
          >
            <LinearGradient
              colors={gradients.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.nextButton}
            >
              <Text style={styles.nextText}>
                {mode === 'edit'
                  ? 'Save profile'
                  : 'Finish setup'}
              </Text>

              <Ionicons
                name="checkmark"
                size={18}
                color="#fff"
              />
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.bg,
  },

  container: {
    flex: 1,
  },

  content: {
    paddingHorizontal: spacing.l,
    paddingTop: 16,
    paddingBottom: 130,
  },

  topBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  brandEyebrow: {
    color: palette.cyan,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 4,
  },

  brandTitle: {
    color: palette.text,
    fontSize: 27,
    lineHeight: 32,
    fontWeight: '900',
    letterSpacing: -0.6,
  },

  brandOrb: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: palette.cyanSoft,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 25,
    marginBottom: 30,
  },

  stepItem: {
    alignItems: 'center',
  },

  stepDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: palette.bgSoft,
    borderWidth: 1,
    borderColor: palette.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },

  stepDotActive: {
    backgroundColor: palette.primary,
    borderColor: palette.primaryStrong,
  },

  stepDotComplete: {
    backgroundColor: palette.cyan,
    borderColor: palette.cyan,
  },

  stepText: {
    color: palette.muted,
    fontSize: 8,
    fontWeight: '800',
    marginTop: 6,
  },

  stepTextActive: {
    color: palette.textSoft,
  },

  stepLine: {
    flex: 1,
    height: 1,
    backgroundColor: palette.hairline,
    marginHorizontal: 8,
    marginTop: -14,
  },

  stepLineComplete: {
    backgroundColor: palette.cyan,
  },

  stepContent: {
    minHeight: 470,
  },

  sectionEyebrow: {
    color: palette.primaryStrong,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.35,
    marginBottom: 5,
  },

  sectionTitle: {
    color: palette.text,
    fontSize: 29,
    lineHeight: 35,
    fontWeight: '900',
    letterSpacing: -0.7,
    maxWidth: 330,
  },

  sectionSubtitle: {
    color: palette.sub,
    fontSize: 12,
    lineHeight: 19,
    marginTop: 7,
    marginBottom: 23,
    maxWidth: 430,
  },

  field: {
    marginBottom: 20,
  },

  label: {
    color: palette.textSoft,
    fontSize: 10,
    fontWeight: '800',
    marginBottom: 7,
    marginTop: 4,
  },

  helper: {
    color: palette.muted,
    fontSize: 9,
    marginTop: -3,
    marginBottom: 9,
  },

  input: {
    minHeight: 50,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderStrong,
    color: palette.text,
    fontSize: 16,
    paddingHorizontal: 0,
    paddingVertical: 10,
  },

  profileNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
  },

  noteIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: palette.cyanSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },

  profileNoteText: {
    flex: 1,
    color: palette.sub,
    fontSize: 10,
    lineHeight: 16,
    paddingTop: 2,
  },

  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 14,
  },

  chip: {
    minHeight: 38,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: palette.hairline,
    backgroundColor: palette.bgSoft,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 7,
    marginBottom: 7,
  },

  chipActive: {
    backgroundColor: palette.primarySoft,
    borderColor: palette.borderStrong,
  },

  chipText: {
    color: palette.sub,
    fontSize: 10,
    fontWeight: '800',
  },

  chipTextActive: {
    color: palette.text,
  },

  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: palette.borderStrong,
  },

  currencyPrefix: {
    color: palette.cyan,
    fontSize: 23,
    fontWeight: '900',
    marginRight: 8,
  },

  amountInput: {
    flex: 1,
    minHeight: 56,
    color: palette.text,
    fontSize: 23,
    fontWeight: '900',
    paddingVertical: 10,
  },

  incomePreview: {
    borderRadius: 22,
    paddingHorizontal: 17,
    paddingVertical: 16,
    marginBottom: 19,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...shadow(6, 0.16),
  },

  previewLabel: {
    color: '#C7DBF8',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },

  previewValue: {
    color: '#fff',
    fontSize: 23,
    fontWeight: '900',
    marginTop: 3,
  },

  toggleRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.hairline,
  },

  toggleCopy: {
    flex: 1,
    paddingRight: 12,
  },

  toggleTitle: {
    color: palette.text,
    fontSize: 12,
    fontWeight: '800',
  },

  toggleDescription: {
    color: palette.sub,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 3,
    maxWidth: 300,
  },

  autoIncomeSection: {
    paddingTop: 16,
  },

  toggleRowCompact: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  dateRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },

  dateIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: palette.cyanSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },

  dateText: {
    flex: 1,
    color: palette.textSoft,
    fontSize: 11,
    fontWeight: '700',
  },

  pickerSurface: {
    marginTop: 9,
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    overflow: 'hidden',
  },

  pickerDone: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
  },

  pickerDoneText: {
    color: palette.cyan,
    fontSize: 11,
    fontWeight: '900',
  },

  alertSection: {
    marginTop: 17,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
  },

  alertHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },

  alertIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: palette.cyanSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },

  alertTitle: {
    color: palette.text,
    fontSize: 13,
    fontWeight: '800',
  },

  alertDescription: {
    color: palette.sub,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 3,
  },

  percentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderStrong,
  },

  percentInput: {
    flex: 1,
    minHeight: 52,
    color: palette.text,
    fontSize: 22,
    fontWeight: '900',
    paddingVertical: 8,
  },

  percentSymbol: {
    color: palette.cyan,
    fontSize: 19,
    fontWeight: '900',
  },

  alertPreview: {
    color: palette.sub,
    fontSize: 9,
    lineHeight: 15,
    marginTop: 8,
  },

  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 86,
    paddingHorizontal: spacing.l,
    paddingTop: 12,
    paddingBottom:
      Platform.OS === 'ios' ? 24 : 14,
    backgroundColor: 'rgba(6,16,31,0.96)',
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
    flexDirection: 'row',
    alignItems: 'center',
  },

  backButton: {
    minWidth: 90,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
  },

  backPlaceholder: {
    minWidth: 90,
  },

  backText: {
    color: palette.textSoft,
    fontSize: 11,
    fontWeight: '800',
    marginLeft: 6,
  },

  nextWrap: {
    flex: 1,
    borderRadius: radius.pill,
    overflow: 'hidden',
    ...shadow(7, 0.18),
  },

  nextButton: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  nextText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
    marginRight: 7,
  },
});
