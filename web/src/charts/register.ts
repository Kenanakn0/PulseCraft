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
// Yan etki içe aktarması: zaman ekseninin tarih işlemleri için date-fns bağdaştırıcısını Chart.js'e tanıtır.
import 'chartjs-adapter-date-fns'

// Chart.js'i yalnızca kullandığımız parçalarla kaydediyoruz (tam paketi değil): çıktı boyutu küçük kalır.
// (C#'ta yalnızca gereken servisleri DI'a kaydetmek gibi.) Modül bir kez yüklenince çalışır.
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
