import {
  ArcElement,
  Chart,
  Decimation,
  DoughnutController,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  TimeScale,
  Tooltip,
} from 'chart.js'
// Side-effect import: registers the date-fns adapter used by the time axis.
import 'chartjs-adapter-date-fns'

// Register only the Chart.js parts in use (not the whole bundle) to keep the output small.
Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  DoughnutController,
  ArcElement,
  Tooltip,
  Legend,
  Decimation,
)
