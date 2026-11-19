package demo

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

enum Shape:
  case Circle(r: Double)
  case Rect(w: Double, h: Double)
  case Triangle(a: Double, b: Double, c: Double)

  def area: Double = this match
    case Circle(r)         => math.Pi * r * r
    case Rect(w, h)        => w * h
    case Triangle(a, b, c) =>
      val s = (a + b + c) / 2
      math.sqrt(s * (s - a) * (s - b) * (s - c))

trait Show[A]:
  extension (a: A) def show: String

given Show[Shape] with
  extension (s: Shape) def show: String = f"${s.productPrefix}%-8s area=${s.area}%.2f"

@main def run(): Unit =
  given ExecutionContext = ExecutionContext.global
  val shapes = List(Shape.Circle(1), Shape.Rect(2, 3), Shape.Triangle(3, 4, 5))

  shapes.sortBy(-_.area).map(_.show).foreach(println)

  val total = Future.traverse(shapes)(s => Future(s.area)).map(_.sum)
  total.onComplete {
    case Success(v)  => println(f"总面积 $v%.2f")
    case Failure(ex) => println(s"失败：${ex.getMessage}")
  }
  Thread.sleep(100)
