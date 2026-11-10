from django.db import models


class TimeStamped(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True


class Author(TimeStamped):
    name = models.CharField(max_length=100)
    email = models.EmailField(unique=True)
    bio = models.TextField(null=True, blank=True)  # optional


class Tag(models.Model):
    slug = models.SlugField(primary_key=True)


class Book(TimeStamped):
    title = models.CharField(max_length=200)
    author = models.ForeignKey(Author, on_delete=models.CASCADE, related_name="books")
    editor = models.ForeignKey(
        "Author",
        null=True,
        on_delete=models.SET_NULL,
    )
    price = models.DecimalField(max_digits=8, decimal_places=2)
    tags = models.ManyToManyField(Tag)
    sequel_of = models.OneToOneField("self", null=True, on_delete=models.SET_NULL)

    def __str__(self):
        return self.title


class Publisher(models.Model):
    name = models.CharField(max_length=120)
    books = models.ManyToManyField(Book)

    class Meta:
        db_table = "pub_publisher"
        ordering = ["name"]
