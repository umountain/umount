namespace umount.Models;

public class Mountain
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public double Altitude { get; set; }
    public string Location { get; set; } = string.Empty;
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public List<Visit> Visits { get; set; } = new();

    public int VisitCount => Visits.Count;
}

public class Visit
{
    public DateTime Date { get; set; }
    public string? Duration { get; set; }
    public string? Course { get; set; }
    public ParkingInfo? Parking { get; set; }
}

public class ParkingInfo
{
    public string Name { get; set; } = string.Empty;
    public string? Address { get; set; }
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public string? Fee { get; set; }
}

public class MountainData
{
    public List<Mountain> Mountains { get; set; } = new();
}
