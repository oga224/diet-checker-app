import { useState } from 'react'
import WelcomeScreen  from './components/WelcomeScreen'
import QuestionScreen from './components/QuestionScreen'
import ResultsScreen  from './components/ResultsScreen'
import { QUESTIONS, calcResults } from './data/questions'

export default function App() {
  const [screen,  setScreen]  = useState('welcome') // 'welcome' | 'quiz' | 'results'
  const [step,    setStep]    = useState(0)
  const [answers, setAnswers] = useState({})

  const handleStart = () => {
    setAnswers({})
    setStep(0)
    setScreen('quiz')
  }

  const handleAnswer = (questionId, value) => {
    const next = { ...answers, [questionId]: value }
    setAnswers(next)
    if (step < QUESTIONS.length - 1) {
      setStep((s) => s + 1)
    } else {
      setScreen('results')
    }
  }

  const handleBack = () => {
    if (step > 0) {
      setStep((s) => s - 1)
    } else {
      setScreen('welcome')
    }
  }

  const handleRetry = () => {
    setAnswers({})
    setStep(0)
    setScreen('welcome')
  }

  if (screen === 'welcome') {
    return <WelcomeScreen onStart={handleStart} />
  }

  if (screen === 'quiz') {
    return (
      <QuestionScreen
        step={step}
        answers={answers}
        onAnswer={handleAnswer}
        onBack={handleBack}
      />
    )
  }

  return (
    <ResultsScreen
      results={calcResults(answers)}
      onRetry={handleRetry}
    />
  )
}
